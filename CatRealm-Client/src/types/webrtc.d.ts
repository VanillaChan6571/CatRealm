export {};

declare global {
  interface RTCRtpSender {
    createEncodedStreams?: () => { readable: ReadableStream<RTCEncodedAudioFrame | RTCEncodedVideoFrame>; writable: WritableStream<RTCEncodedAudioFrame | RTCEncodedVideoFrame> };
  }

  interface RTCRtpReceiver {
    createEncodedStreams?: () => { readable: ReadableStream<RTCEncodedAudioFrame | RTCEncodedVideoFrame>; writable: WritableStream<RTCEncodedAudioFrame | RTCEncodedVideoFrame> };
  }
}
