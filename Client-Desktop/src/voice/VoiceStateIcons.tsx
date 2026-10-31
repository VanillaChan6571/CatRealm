import { Mic, MicOff, Monitor, PhoneOff, Settings, Video, VideoOff, Volume2, VolumeX } from 'lucide-react';

type VoiceStateIconProps = { className?: string };

export function MicrophoneLiveIcon({ className }: VoiceStateIconProps) {
  return <Mic className={className} />;
}

export function MicrophoneMutedIcon({ className }: VoiceStateIconProps) {
  return <MicOff className={className} />;
}

export function AudioListeningIcon({ className }: VoiceStateIconProps) {
  return <Volume2 className={className} />;
}

export function AudioDeafenedIcon({ className }: VoiceStateIconProps) {
  return <VolumeX className={className} />;
}

export function CameraIcon({ className }: VoiceStateIconProps) {
  return <Video className={className} />;
}

export function CameraOffIcon({ className }: VoiceStateIconProps) {
  return <VideoOff className={className} />;
}

export function ScreenShareIcon({ className }: VoiceStateIconProps) {
  return <Monitor className={className} />;
}

export function EndCallIcon({ className }: VoiceStateIconProps) {
  return <PhoneOff className={className} />;
}

export function VoiceSettingsIcon({ className }: VoiceStateIconProps) {
  return <Settings className={className} />;
}
