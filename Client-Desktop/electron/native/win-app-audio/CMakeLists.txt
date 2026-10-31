cmake_minimum_required(VERSION 3.20)
project(CatRealmAppAudioCapture CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# Console subsystem — stdout must be available
add_executable(CatRealmAppAudioCapture
    CatRealmAppAudioCapture.cpp
)

target_compile_definitions(CatRealmAppAudioCapture PRIVATE
    WIN32_LEAN_AND_MEAN
    NOMINMAX
    UNICODE
    _UNICODE
    # Minimum Windows 10 (10.0.19041 = 20H1) for process loopback API
    _WIN32_WINNT=0x0A00
    WINVER=0x0A00
    NTDDI_VERSION=0x0A00000C   # NTDDI_WIN10_VB (20H1)
)

if(MSVC)
    # Static CRT — no runtime DLL dependency
    set_property(TARGET CatRealmAppAudioCapture PROPERTY
        MSVC_RUNTIME_LIBRARY "MultiThreaded$<$<CONFIG:Debug>:Debug>")

    target_compile_options(CatRealmAppAudioCapture PRIVATE
        /W3
        /WX-
        /utf-8
        /GS          # Buffer security checks
        /Gy          # Function-level linking
        $<$<CONFIG:Release>:/O2 /GL>
    )

    target_link_options(CatRealmAppAudioCapture PRIVATE
        $<$<CONFIG:Release>:/LTCG /OPT:REF /OPT:ICF>
    )
endif()

target_link_libraries(CatRealmAppAudioCapture PRIVATE
    ole32
    oleaut32
    avrt
    mmdevapi
    user32
    uuid
)

# Place the built executable in the bin/ directory expected by the Electron bridge
set_target_properties(CatRealmAppAudioCapture PROPERTIES
    RUNTIME_OUTPUT_DIRECTORY                "${CMAKE_CURRENT_SOURCE_DIR}/bin"
    RUNTIME_OUTPUT_DIRECTORY_DEBUG          "${CMAKE_CURRENT_SOURCE_DIR}/bin"
    RUNTIME_OUTPUT_DIRECTORY_RELEASE        "${CMAKE_CURRENT_SOURCE_DIR}/bin"
    RUNTIME_OUTPUT_DIRECTORY_RELWITHDEBINFO "${CMAKE_CURRENT_SOURCE_DIR}/bin"
    RUNTIME_OUTPUT_DIRECTORY_MINSIZEREL     "${CMAKE_CURRENT_SOURCE_DIR}/bin"
)
