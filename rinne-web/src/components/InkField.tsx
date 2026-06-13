import { useEffect, useRef } from "react";

/** The living field behind every page: blue ink blooming through water
 *  (Pexels 3024109, Dan Cristian Pădureț, self-hosted), washed back to
 *  cream with graph-paper rules on top. `calm` raises the wash so product
 *  pages stay quiet while the same liquid keeps moving underneath. */
export default function InkField({ calm = false }: { calm?: boolean }) {
  const video = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
      video.current?.pause();
    }
  }, []);
  return (
    <div className="field" aria-hidden>
      <video ref={video} className="bgvid" autoPlay muted loop playsInline preload="auto">
        <source src="/media/ink-1280.webm" type="video/webm" />
        <source src="/media/ink-1280.mp4" type="video/mp4" />
      </video>
      <div className={calm ? "wash wash-calm" : "wash"} />
    </div>
  );
}
