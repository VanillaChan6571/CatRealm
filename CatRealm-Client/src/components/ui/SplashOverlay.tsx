interface SplashOverlayProps {
  visible: boolean;
  message?: string;
  backgroundColor?: string;
}

export function SplashOverlay({
  visible,
  message,
  backgroundColor = '#7c5cff',
}: SplashOverlayProps) {
  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        backgroundColor,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 28,
        transition: 'opacity 400ms ease',
        opacity: visible ? 1 : 0,
        pointerEvents: visible ? 'all' : 'none',
      }}
    >
      <img
        src="./CatRealm.png"
        alt="CatRealm"
        style={{
          width: 160,
          height: 160,
          filter: 'drop-shadow(0 8px 32px rgba(0,0,0,0.35))',
        }}
      />
      {message && (
        <p
          style={{
            color: 'rgba(255,255,255,0.9)',
            fontSize: 15,
            fontWeight: 500,
            margin: 0,
            letterSpacing: '0.02em',
          }}
        >
          {message}
        </p>
      )}
    </div>
  );
}
