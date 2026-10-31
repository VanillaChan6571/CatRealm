import type { ReactNode } from 'react';

export function AuthBackdrop({ children }: { children: ReactNode }) {
  return (
    <div className="invite-backdrop min-h-screen relative flex items-center justify-center px-4 py-8 sm:py-4 overflow-x-hidden">
      <div
        aria-hidden="true"
        className="invite-orb-a pointer-events-none fixed left-[-220px] bottom-[-170px] h-[390px] w-[390px] rounded-full opacity-80 blur-[8px] sm:left-[-160px] sm:bottom-[-190px] sm:h-[460px] sm:w-[460px]"
      />
      <div
        aria-hidden="true"
        className="invite-orb-b pointer-events-none fixed right-[-210px] top-[56px] h-[340px] w-[340px] rounded-full opacity-70 blur-[7px] sm:right-[-130px] sm:top-[88px] sm:h-[390px] sm:w-[390px]"
      />
      <div
        aria-hidden="true"
        className="invite-stars pointer-events-none fixed inset-0"
      />
      <div className="relative z-10 w-full flex min-h-[calc(100vh-4rem)] items-center justify-center sm:min-h-[calc(100vh-2rem)]">
        {children}
      </div>
    </div>
  );
}
