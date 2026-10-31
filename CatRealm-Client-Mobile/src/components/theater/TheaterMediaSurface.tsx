import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Animated, StyleSheet, TouchableOpacity, View } from 'react-native';
import { useEvent } from 'expo';
import { isPictureInPictureSupported, useVideoPlayer, VideoView } from 'expo-video';
import YoutubeIframe, { type YoutubeIframeRef } from 'react-native-youtube-iframe';
import { PictureInPicture2 } from 'lucide-react-native';
import { useAuthStore } from '@/stores/authStore';
import { useServerStore } from '@/stores/serverStore';
import { theaterMediaSource, theaterYouTubeId } from '@/lib/theaterMedia';
import { theaterYouTubeFrame } from '@/lib/theaterLayout';
import { Text } from '../Text';

const SYNC_THRESHOLD_MS = 2500;
export type TheaterMediaKind = 'youtube' | 'video';
export const isTheaterYouTubeUrl = (url: string) => theaterYouTubeId(url) !== null;

type Props = {
  videoUrl: string;
  playing: boolean;
  positionMs: number;
  width: number;
  height: number;
  muted?: boolean;
  volume?: number;
  interactive?: boolean;
  pictureInPictureTop?: number;
  controlsVisible?: boolean;
  controlsOpacity?: Animated.Value;
  onControlsInteraction?: () => void;
  onResolvedKind?: (kind: TheaterMediaKind) => void;
};

// Separate players: an empty native player must not take audio focus from YouTube.
export function TheaterMediaSurface(props: Props) {
  const ytId = theaterYouTubeId(props.videoUrl);
  useEffect(() => { props.onResolvedKind?.(ytId ? 'youtube' : 'video'); }, [props.onResolvedKind, ytId]);
  return ytId ? <YouTubeSurface key={ytId} {...props} videoId={ytId} /> : <NativeVideoSurface {...props} />;
}

function YouTubeSurface({ videoId, playing, positionMs, width, height, muted = false, volume = 1, interactive = false }: Props & { videoId: string }) {
  const ref = useRef<YoutubeIframeRef>(null);
  const [ready, setReady] = useState(false);
  const frame = theaterYouTubeFrame(width, height);
  // YouTube's seekTo() STARTS playback when the video is unstarted or cued, so
  // load cued at the shared position and only seek once it has started.
  const [startSeconds] = useState(() => Math.floor(Math.max(0, positionMs) / 1000));
  const [playerState, setPlayerState] = useState('unstarted');
  // The library's `play` prop posts messages that never reached the player on
  // iOS, so the room's play state was ignored. Converge YouTube onto it through
  // injected JavaScript whenever either side changes.
  useEffect(() => {
    if (!ready) return;
    const running = playerState === 'playing' || playerState === 'buffering';
    if (playing && !running && playerState !== 'ended') ref.current?.playVideo();
    else if (!playing && running) ref.current?.pauseVideo();
  }, [playerState, playing, ready]);
  useEffect(() => {
    if (!ready || playerState === 'unstarted' || playerState === 'video cued') return;
    let cancelled = false;
    void ref.current?.getCurrentTime().then((seconds) => {
      if (!cancelled && Math.abs(seconds * 1000 - positionMs) > SYNC_THRESHOLD_MS) ref.current?.seekTo(positionMs / 1000, true);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [playerState, positionMs, ready]);
  // The embed page uses width-based 16:9 CSS. Giving it the entire landscape
  // width with a shorter height crops the page instead of containing the video.
  // Resize the same WebView (not its source/key) to preserve playback on rotation.
  return <View testID="theater-youtube-container" pointerEvents={interactive ? 'auto' : 'none'}
    style={{ width, height, backgroundColor: '#000', alignItems: 'center', justifyContent: 'center' }}><YoutubeIframe
    ref={ref} videoId={videoId} height={frame.height} width={frame.width}
    allowWebViewZoom={false}
    play={playing} mute={muted} volume={Math.round(volume * 100)} onReady={() => setReady(true)}
    onChangeState={setPlayerState}
    initialPlayerParams={{ rel: false, controls: false, start: startSeconds }}
    webViewProps={{
      scrollEnabled: false,
      allowsInlineMediaPlayback: true,
      mediaPlaybackRequiresUserAction: false,
      injectedJavaScript: !interactive
        ? "(function(){var o=document.createElement('div');o.style.cssText='position:fixed;inset:0;z-index:99999;background:transparent;';document.body.appendChild(o);})();true;"
        : undefined,
    }}
  /></View>;
}

function NativeVideoSurface({ videoUrl, playing, positionMs, width, height, muted = false, volume = 1, pictureInPictureTop = 8, controlsVisible = true, controlsOpacity, onControlsInteraction }: Props) {
  const token = useAuthStore((s) => s.token);
  const accountType = useAuthStore((s) => s.user?.accountType);
  const serverUrl = useAuthStore((s) => s.serverUrl);
  const servers = useServerStore((s) => s.servers);
  const source = useMemo(() => theaterMediaSource(videoUrl, accountType === 'central'
    ? servers : serverUrl ? [{ url: serverUrl, token }] : []), [accountType, serverUrl, servers, token, videoUrl]);
  const view = useRef<VideoView>(null);
  const player = useVideoPlayer(source, (instance) => {
    instance.loop = false;
    instance.audioMixingMode = 'mixWithOthers';
    instance.staysActiveInBackground = true;
  });
  const { status, error } = useEvent(player, 'statusChange', { status: player.status, error: undefined });
  useEffect(() => {
    player.muted = muted;
    player.volume = volume;
  }, [muted, player, volume]);
  useEffect(() => {
    if (status !== 'readyToPlay') return;
    if (playing && !player.playing) player.play();
    else if (!playing && player.playing) player.pause();
  }, [player, playing, status]);
  useEffect(() => {
    if (status !== 'readyToPlay') return;
    // Native PiP pause is a local pause. Do not undo it on every sync tick;
    // catch back up when the user resumes or the host changes playback state.
    if (playing && !player.playing) return;
    if (Math.abs(player.currentTime * 1000 - positionMs) > (playing ? SYNC_THRESHOLD_MS : 100)) player.currentTime = positionMs / 1000;
  }, [player, playing, positionMs, status]);

  return <View style={{ width, height, backgroundColor: '#000' }}>
    <VideoView pointerEvents="none" ref={view} player={player} style={StyleSheet.absoluteFill} contentFit="contain"
      surfaceType="textureView" nativeControls={false} allowsPictureInPicture startsPictureInPictureAutomatically />
    {status === 'loading' && <ActivityIndicator style={StyleSheet.absoluteFill} color="#fff" />}
    {status === 'error' && <Text style={{ color: '#fff', padding: 12 }}>{error?.message || 'Unable to play this video.'}</Text>}
    {isPictureInPictureSupported() && <Animated.View testID="theater-pip-control"
      pointerEvents={controlsVisible ? 'auto' : 'none'} accessibilityElementsHidden={!controlsVisible}
      importantForAccessibility={controlsVisible ? 'auto' : 'no-hide-descendants'}
      style={[styles.pip, { top: pictureInPictureTop, opacity: controlsOpacity ?? 1 }]}>
      <TouchableOpacity accessibilityLabel="Picture in picture" style={{ padding: 12 }}
        onPress={(event) => { event.stopPropagation(); onControlsInteraction?.(); void view.current?.startPictureInPicture().catch(() => Alert.alert('Picture in picture', 'PiP is not available for this video right now.')); }}>
        <PictureInPicture2 size={20} color="#fff" />
      </TouchableOpacity>
    </Animated.View>}
  </View>;
}

const styles = StyleSheet.create({
  pip: { position: 'absolute', top: 8, right: 8, borderRadius: 24, backgroundColor: 'rgba(0,0,0,0.55)' },
});
