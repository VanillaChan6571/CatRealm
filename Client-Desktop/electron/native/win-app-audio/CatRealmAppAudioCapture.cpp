// CatRealmAppAudioCapture.cpp
// Per-process WASAPI loopback capture for CatRealm (Windows 10 build 20348+).
// Streams raw interleaved f32le PCM to stdout; status lines to stderr.
//
// Usage:
//   CatRealmAppAudioCapture.exe --format f32le --sample-rate 48000 --channels 2
//       --include-child-processes { --pid <pid> | --hwnd <hwnd> }

#pragma comment(lib, "ole32.lib")
#pragma comment(lib, "oleaut32.lib")
#pragma comment(lib, "avrt.lib")
#pragma comment(lib, "mmdevapi.lib")
#pragma comment(lib, "user32.lib")
#pragma comment(lib, "uuid.lib")

#ifndef NOMINMAX
#define NOMINMAX
#endif
#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#include <windows.h>
#include <mmdeviceapi.h>
#include <audioclient.h>
#include <audiopolicy.h>
#include <avrt.h>
#include <wrl/client.h>
#include <winternl.h>
#include <initguid.h>
#include <ks.h>
#include <ksmedia.h>

#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <cstdint>
#include <string>
#include <vector>
#include <atomic>
#include <io.h>
#include <fcntl.h>

using Microsoft::WRL::ComPtr;

// ─── Process loopback types (Windows SDK 10.0.19041+) ────────────────────────
// Guard against redefinition if the SDK already provides them.

#ifndef VIRTUAL_AUDIO_DEVICE_PROCESS_LOOPBACK
#define VIRTUAL_AUDIO_DEVICE_PROCESS_LOOPBACK L"VAD\\Process_Loopback"
#endif

#ifndef AUDIOCLIENT_ACTIVATION_TYPE_PROCESS_LOOPBACK
typedef enum _CR_AUDIOCLIENT_ACTIVATION_TYPE {
    CR_AUDIOCLIENT_ACTIVATION_TYPE_DEFAULT          = 0,
    CR_AUDIOCLIENT_ACTIVATION_TYPE_PROCESS_LOOPBACK = 1,
} CR_AUDIOCLIENT_ACTIVATION_TYPE;
#define AUDIOCLIENT_ACTIVATION_TYPE CR_AUDIOCLIENT_ACTIVATION_TYPE
#define AUDIOCLIENT_ACTIVATION_TYPE_DEFAULT          CR_AUDIOCLIENT_ACTIVATION_TYPE_DEFAULT
#define AUDIOCLIENT_ACTIVATION_TYPE_PROCESS_LOOPBACK CR_AUDIOCLIENT_ACTIVATION_TYPE_PROCESS_LOOPBACK
#endif

#ifndef PROCESS_LOOPBACK_MODE_INCLUDE_TARGET_PROCESS_TREE
typedef enum _CR_PROCESS_LOOPBACK_MODE {
    CR_PROCESS_LOOPBACK_MODE_INCLUDE_TARGET_PROCESS_TREE = 0,
    CR_PROCESS_LOOPBACK_MODE_EXCLUDE_TARGET_PROCESS_TREE = 1,
} CR_PROCESS_LOOPBACK_MODE;
#define PROCESS_LOOPBACK_MODE CR_PROCESS_LOOPBACK_MODE
#define PROCESS_LOOPBACK_MODE_INCLUDE_TARGET_PROCESS_TREE CR_PROCESS_LOOPBACK_MODE_INCLUDE_TARGET_PROCESS_TREE
#define PROCESS_LOOPBACK_MODE_EXCLUDE_TARGET_PROCESS_TREE CR_PROCESS_LOOPBACK_MODE_EXCLUDE_TARGET_PROCESS_TREE
#endif

#ifndef AUDIOCLIENT_PROCESS_LOOPBACK_PARAMS
typedef struct _CR_AUDIOCLIENT_PROCESS_LOOPBACK_PARAMS {
    DWORD                TargetProcessId;
    PROCESS_LOOPBACK_MODE ProcessLoopbackMode;
} CR_AUDIOCLIENT_PROCESS_LOOPBACK_PARAMS;
#define AUDIOCLIENT_PROCESS_LOOPBACK_PARAMS CR_AUDIOCLIENT_PROCESS_LOOPBACK_PARAMS
#endif

#ifndef AUDIOCLIENT_ACTIVATION_PARAMS
typedef struct _CR_AUDIOCLIENT_ACTIVATION_PARAMS {
    AUDIOCLIENT_ACTIVATION_TYPE ActivationType;
    union {
        AUDIOCLIENT_PROCESS_LOOPBACK_PARAMS ProcessLoopbackParams;
    };
} CR_AUDIOCLIENT_ACTIVATION_PARAMS;
#define AUDIOCLIENT_ACTIVATION_PARAMS CR_AUDIOCLIENT_ACTIVATION_PARAMS
#endif

// ─── Global stop flag ─────────────────────────────────────────────────────────

static std::atomic<bool> g_stop{ false };

static BOOL WINAPI ctrlHandler(DWORD type) {
    switch (type) {
    case CTRL_C_EVENT:
    case CTRL_BREAK_EVENT:
    case CTRL_CLOSE_EVENT:
    case CTRL_SHUTDOWN_EVENT:
    case CTRL_LOGOFF_EVENT:
        g_stop.store(true, std::memory_order_relaxed);
        return TRUE;
    default:
        return FALSE;
    }
}

static void logWindowsBuild() {
    auto ntdll = GetModuleHandleW(L"ntdll.dll");
    if (!ntdll) return;

    using RtlGetVersionFn = LONG(WINAPI*)(PRTL_OSVERSIONINFOW);
    auto rtlGetVersion = reinterpret_cast<RtlGetVersionFn>(
        GetProcAddress(ntdll, "RtlGetVersion"));
    if (!rtlGetVersion) return;

    RTL_OSVERSIONINFOW version = {};
    version.dwOSVersionInfoSize = sizeof(version);
    if (rtlGetVersion(&version) != 0) return;

    fprintf(stderr, "info: windows version %lu.%lu build %lu\n",
        static_cast<unsigned long>(version.dwMajorVersion),
        static_cast<unsigned long>(version.dwMinorVersion),
        static_cast<unsigned long>(version.dwBuildNumber));
    if (version.dwBuildNumber < 20348) {
        fprintf(stderr,
            "warn: process loopback capture requires Windows build 20348 or later\n");
    }
}

// ─── Async activation completion handler ──────────────────────────────────────

class ActivationHandler final
    : public IActivateAudioInterfaceCompletionHandler
    , public IAgileObject {
public:
    explicit ActivationHandler()
        : m_ref(1)
        , m_event(CreateEventW(nullptr, TRUE, FALSE, nullptr))
        , m_result(E_PENDING)
    {}

    ~ActivationHandler() {
        if (m_event) CloseHandle(m_event);
    }

    // Wait for activation to complete. Returns S_OK on success, E_FAIL on timeout.
    HRESULT Wait(DWORD timeoutMs = 8000) {
        if (!m_event) return E_FAIL;
        return WaitForSingleObject(m_event, timeoutMs) == WAIT_OBJECT_0 ? S_OK : E_FAIL;
    }

    HRESULT TakeClient(IAudioClient** ppOut) {
        if (!ppOut) return E_POINTER;
        if (FAILED(m_result)) return m_result;
        return m_client.CopyTo(ppOut);
    }

    // IUnknown
    ULONG STDMETHODCALLTYPE AddRef()  override { return ++m_ref; }
    ULONG STDMETHODCALLTYPE Release() override {
        ULONG r = --m_ref;
        if (r == 0) delete this;
        return r;
    }
    HRESULT STDMETHODCALLTYPE QueryInterface(REFIID riid, void** ppv) override {
        if (!ppv) return E_POINTER;
        if (riid == IID_IUnknown ||
            riid == __uuidof(IActivateAudioInterfaceCompletionHandler)) {
            AddRef();
            *ppv = static_cast<IActivateAudioInterfaceCompletionHandler*>(this);
            return S_OK;
        }
        if (riid == __uuidof(IAgileObject)) {
            AddRef();
            *ppv = static_cast<IAgileObject*>(this);
            return S_OK;
        }
        *ppv = nullptr;
        return E_NOINTERFACE;
    }

    // IActivateAudioInterfaceCompletionHandler
    HRESULT STDMETHODCALLTYPE ActivateCompleted(
        IActivateAudioInterfaceAsyncOperation* op) override
    {
        HRESULT hrActivate = S_OK;
        ComPtr<IUnknown> pUnk;
        op->GetActivateResult(&hrActivate, &pUnk);
        m_result = hrActivate;
        if (SUCCEEDED(hrActivate) && pUnk) {
            pUnk.As(&m_client);
        }
        SetEvent(m_event);
        return S_OK;
    }

private:
    std::atomic<ULONG> m_ref;
    HANDLE             m_event;
    HRESULT            m_result;
    ComPtr<IAudioClient> m_client;
};

// ─── Argument parsing ─────────────────────────────────────────────────────────

struct Args {
    DWORD       pid              = 0;
    HWND        hwnd             = nullptr;
    int         sampleRate       = 48000;
    int         channels         = 2;
    bool        includeChildren  = false;
};

static int clampChannels(int channels) {
    if (channels < 1) return 1;
    if (channels > 8) return 8;
    return channels;
}

static int clampSampleRate(int sampleRate) {
    if (sampleRate < 8000) return 8000;
    if (sampleRate > 192000) return 192000;
    return sampleRate;
}

static bool parseArgs(int argc, char* argv[], Args& out) {
    for (int i = 1; i < argc; ++i) {
        const char* a = argv[i];
        if (!strcmp(a, "--pid") && i + 1 < argc)
            out.pid = static_cast<DWORD>(std::stoul(argv[++i]));
        else if (!strcmp(a, "--hwnd") && i + 1 < argc)
            out.hwnd = reinterpret_cast<HWND>(static_cast<uintptr_t>(std::stoull(argv[++i])));
        else if (!strcmp(a, "--sample-rate") && i + 1 < argc)
            out.sampleRate = std::stoi(argv[++i]);
        else if (!strcmp(a, "--channels") && i + 1 < argc)
            out.channels = std::stoi(argv[++i]);
        else if (!strcmp(a, "--include-child-processes"))
            out.includeChildren = true;
        // --format f32le is the only supported format; ignore the value
    }
    out.sampleRate = clampSampleRate(out.sampleRate);
    out.channels = clampChannels(out.channels);
    return out.pid != 0 || out.hwnd != nullptr;
}

// ─── Sample conversion to float ───────────────────────────────────────────────

static float pcmToFloat(const BYTE* src, WORD bitsPerSample, bool isFloat) {
    if (isFloat) {
        float v;
        memcpy(&v, src, sizeof(float));
        return v;
    }
    if (bitsPerSample == 16) {
        int16_t v;
        memcpy(&v, src, 2);
        return v * (1.0f / 32768.0f);
    }
    if (bitsPerSample == 24) {
        // 24-bit packed little-endian
        int32_t v = 0;
        memcpy(reinterpret_cast<BYTE*>(&v), src, 3);
        if (v & 0x800000) v |= 0xFF000000; // sign-extend
        return v * (1.0f / 8388608.0f);
    }
    if (bitsPerSample == 32) {
        int32_t v;
        memcpy(&v, src, 4);
        return v * (1.0f / 2147483648.0f);
    }
    return 0.0f;
}

// Convert one WASAPI packet to interleaved f32le and write to stdout.
// srcChannels: channels in the capture buffer
// outChannels: channels caller requested (typically 2)
// Returns false if stdout write failed.
static bool convertAndWrite(
    const BYTE* buf,
    UINT32      frames,
    const WAVEFORMATEX* fmt,
    int         outChannels,
    std::vector<float>& scratch)
{
    const WORD srcChannels   = fmt->nChannels;
    const WORD bitsPerSample = fmt->wBitsPerSample;
    const WORD blockAlign    = fmt->nBlockAlign;
    const WORD sampleBytes   = srcChannels > 0 ? blockAlign / srcChannels : 4;

    bool isFloat = false;
    if (fmt->wFormatTag == WAVE_FORMAT_EXTENSIBLE) {
        const auto* ex = reinterpret_cast<const WAVEFORMATEXTENSIBLE*>(fmt);
        isFloat = (ex->SubFormat == KSDATAFORMAT_SUBTYPE_IEEE_FLOAT);
    } else {
        isFloat = (fmt->wFormatTag == WAVE_FORMAT_IEEE_FLOAT);
    }

    scratch.resize(static_cast<size_t>(frames) * outChannels);

    for (UINT32 f = 0; f < frames; ++f) {
        const BYTE* frame = buf + f * blockAlign;
        for (int oc = 0; oc < outChannels; ++oc) {
            // If fewer source channels than output, repeat the last source channel.
            int ic = (oc < srcChannels) ? oc : srcChannels - 1;
            scratch[f * outChannels + oc] =
                pcmToFloat(frame + ic * sampleBytes, bitsPerSample, isFloat);
        }
    }

    const BYTE* out  = reinterpret_cast<const BYTE*>(scratch.data());
    size_t      total = scratch.size() * sizeof(float);
    size_t      done  = 0;
    while (done < total) {
        int n = _write(1, out + done, static_cast<unsigned int>(total - done));
        if (n <= 0) return false;
        done += static_cast<size_t>(n);
    }
    return true;
}

static bool writeSilence(UINT32 frames, int outChannels, std::vector<float>& scratch) {
    scratch.assign(static_cast<size_t>(frames) * outChannels, 0.0f);
    const BYTE* out   = reinterpret_cast<const BYTE*>(scratch.data());
    size_t      total = scratch.size() * sizeof(float);
    size_t      done  = 0;
    while (done < total) {
        int n = _write(1, out + done, static_cast<unsigned int>(total - done));
        if (n <= 0) return false;
        done += static_cast<size_t>(n);
    }
    return true;
}

// ─── Entry point ──────────────────────────────────────────────────────────────

int main(int argc, char* argv[]) {
    _setmode(1, _O_BINARY);  // stdout: raw binary
    _setmode(2, _O_TEXT);    // stderr: text

    SetConsoleCtrlHandler(ctrlHandler, TRUE);

    Args args;
    if (!parseArgs(argc, argv, args)) {
        fprintf(stderr, "error: --pid <pid> or --hwnd <hwnd> is required\n");
        return 1;
    }

    // Resolve HWND → PID
    DWORD targetPid = args.pid;
    if (targetPid == 0 && args.hwnd) {
        DWORD threadId = GetWindowThreadProcessId(args.hwnd, &targetPid);
        if (threadId == 0 || targetPid == 0) {
            fprintf(stderr, "error: could not resolve HWND %p to a process id\n",
                static_cast<void*>(args.hwnd));
            return 1;
        }
    }

    fprintf(stderr, "info: pid=%lu includeChildren=%s\n",
        static_cast<unsigned long>(targetPid),
        args.includeChildren ? "true" : "false");
    logWindowsBuild();

    HRESULT hr = CoInitializeEx(nullptr, COINIT_MULTITHREADED);
    if (FAILED(hr)) {
        fprintf(stderr, "error: CoInitializeEx failed hr=0x%08X\n", hr);
        return 1;
    }

    // Build activation params
    AUDIOCLIENT_ACTIVATION_PARAMS ap = {};
    ap.ActivationType = AUDIOCLIENT_ACTIVATION_TYPE_PROCESS_LOOPBACK;
    ap.ProcessLoopbackParams.TargetProcessId   = targetPid;
    ap.ProcessLoopbackParams.ProcessLoopbackMode =
        args.includeChildren
        ? PROCESS_LOOPBACK_MODE_INCLUDE_TARGET_PROCESS_TREE
        : PROCESS_LOOPBACK_MODE_EXCLUDE_TARGET_PROCESS_TREE;

    PROPVARIANT pv = {};
    pv.vt               = VT_BLOB;
    pv.blob.cbSize      = sizeof(ap);
    pv.blob.pBlobData   = reinterpret_cast<BYTE*>(&ap);

    // Activate IAudioClient asynchronously
    auto* handler = new ActivationHandler();
    ComPtr<IActivateAudioInterfaceAsyncOperation> asyncOp;

    hr = ActivateAudioInterfaceAsync(
        VIRTUAL_AUDIO_DEVICE_PROCESS_LOOPBACK,
        __uuidof(IAudioClient),
        &pv,
        handler,
        &asyncOp);
    if (FAILED(hr)) {
        fprintf(stderr, "error: ActivateAudioInterfaceAsync hr=0x%08X\n", hr);
        handler->Release();
        CoUninitialize();
        return 1;
    }

    if (FAILED(handler->Wait(8000))) {
        fprintf(stderr, "error: audio interface activation timed out\n");
        handler->Release();
        CoUninitialize();
        return 1;
    }

    ComPtr<IAudioClient> client;
    hr = handler->TakeClient(&client);
    handler->Release();
    handler = nullptr;

    if (FAILED(hr) || !client) {
        fprintf(stderr, "error: audio client activation failed hr=0x%08X\n", hr);
        CoUninitialize();
        return 1;
    }

    // Process-loopback activates a virtual audio client. On some current
    // Windows builds GetMixFormat returns E_NOTIMPL for that virtual client,
    // so initialize with the requested shared-mode format directly.
    WAVEFORMATEX captureFormat = {};
    captureFormat.wFormatTag = WAVE_FORMAT_IEEE_FLOAT;
    captureFormat.nChannels = static_cast<WORD>(args.channels);
    captureFormat.nSamplesPerSec = static_cast<DWORD>(args.sampleRate);
    captureFormat.wBitsPerSample = 32;
    captureFormat.nBlockAlign = static_cast<WORD>(captureFormat.nChannels * sizeof(float));
    captureFormat.nAvgBytesPerSec = captureFormat.nSamplesPerSec * captureFormat.nBlockAlign;
    captureFormat.cbSize = 0;

    fprintf(stderr, "info: capture format %u Hz %u ch %u bit float\n",
        captureFormat.nSamplesPerSec, captureFormat.nChannels, captureFormat.wBitsPerSample);

    // Event for buffer-ready notification
    HANDLE hEvent = CreateEventW(nullptr, FALSE, FALSE, nullptr);
    if (!hEvent) {
        fprintf(stderr, "error: CreateEvent failed\n");
        CoUninitialize();
        return 1;
    }

    // Initialize: shared loopback, event-driven, 200 ms buffer
    const REFERENCE_TIME bufDuration = 200 * 10000LL;
    hr = client->Initialize(
        AUDCLNT_SHAREMODE_SHARED,
        AUDCLNT_STREAMFLAGS_LOOPBACK | AUDCLNT_STREAMFLAGS_EVENTCALLBACK | AUDCLNT_STREAMFLAGS_AUTOCONVERTPCM,
        bufDuration,
        0,
        &captureFormat,
        nullptr);
    if (FAILED(hr)) {
        fprintf(stderr, "error: IAudioClient::Initialize hr=0x%08X\n", hr);
        CloseHandle(hEvent);
        CoUninitialize();
        return 1;
    }

    hr = client->SetEventHandle(hEvent);
    if (FAILED(hr)) {
        fprintf(stderr, "error: SetEventHandle hr=0x%08X\n", hr);
        CloseHandle(hEvent);
        CoUninitialize();
        return 1;
    }

    ComPtr<IAudioCaptureClient> capture;
    hr = client->GetService(__uuidof(IAudioCaptureClient), &capture);
    if (FAILED(hr)) {
        fprintf(stderr, "error: GetService(IAudioCaptureClient) hr=0x%08X\n", hr);
        CloseHandle(hEvent);
        CoUninitialize();
        return 1;
    }

    // Elevate thread priority for audio processing
    DWORD taskIndex = 0;
    HANDLE hTask = AvSetMmThreadCharacteristics(L"Audio", &taskIndex);

    hr = client->Start();
    if (FAILED(hr)) {
        fprintf(stderr, "error: IAudioClient::Start hr=0x%08X\n", hr);
        if (hTask) AvRevertMmThreadCharacteristics(hTask);
        CloseHandle(hEvent);
        CoUninitialize();
        return 1;
    }

    fprintf(stderr, "info: capture started sampleRate=%u channels=%u\n",
        captureFormat.nSamplesPerSec, captureFormat.nChannels);

    std::vector<float> scratch;
    scratch.reserve(static_cast<size_t>(captureFormat.nSamplesPerSec / 5) * args.channels);

    bool running = true;
    while (running && !g_stop.load(std::memory_order_relaxed)) {
        DWORD waitRes = WaitForSingleObject(hEvent, 150);
        if (waitRes == WAIT_FAILED) {
            fprintf(stderr, "error: WaitForSingleObject failed\n");
            break;
        }
        if (g_stop.load(std::memory_order_relaxed)) break;
        // On timeout (process may be silent): loop and check stop flag
        if (waitRes == WAIT_TIMEOUT) continue;

        UINT32 packetSize = 0;
        hr = capture->GetNextPacketSize(&packetSize);
        if (FAILED(hr)) {
            fprintf(stderr, "warn: GetNextPacketSize hr=0x%08X\n", hr);
            break;
        }

        while (packetSize > 0) {
            BYTE*  pData   = nullptr;
            UINT32 frames  = 0;
            DWORD  flags   = 0;
            hr = capture->GetBuffer(&pData, &frames, &flags, nullptr, nullptr);
            if (FAILED(hr)) {
                fprintf(stderr, "warn: GetBuffer hr=0x%08X\n", hr);
                running = false;
                break;
            }

            bool ok;
            if ((flags & AUDCLNT_BUFFERFLAGS_SILENT) || !pData || frames == 0) {
                ok = writeSilence(frames, args.channels, scratch);
            } else {
                ok = convertAndWrite(pData, frames, &captureFormat, args.channels, scratch);
            }

            capture->ReleaseBuffer(frames);

            if (!ok) {
                // stdout closed (Electron killed us) — stop cleanly
                running = false;
                break;
            }

            hr = capture->GetNextPacketSize(&packetSize);
            if (FAILED(hr)) {
                running = false;
                break;
            }
        }
    }

    client->Stop();
    if (hTask) AvRevertMmThreadCharacteristics(hTask);
    CloseHandle(hEvent);
    CoUninitialize();

    fprintf(stderr, "info: capture stopped\n");
    return 0;
}
