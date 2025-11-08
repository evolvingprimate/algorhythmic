import { useRef } from "react";
import heroVideo from "@assets/Surreal_flowing_abstract_art_video_1762635004997.mp4";
import heroImage from "@assets/generated_images/Surreal_flowing_abstract_art_0d26abec.png";

export function AnimatedBackground() {
  const videoRef = useRef<HTMLVideoElement>(null);

  const handleLoadedMetadata = () => {
    if (videoRef.current) {
      // Set playback rate to 50% slower once metadata is loaded
      videoRef.current.playbackRate = 0.5;
    }
  };

  return (
    <div className="fixed inset-0 -z-10 overflow-hidden">
      <video
        ref={videoRef}
        autoPlay
        loop
        muted
        playsInline
        poster={heroImage}
        aria-hidden="true"
        onLoadedMetadata={handleLoadedMetadata}
        className="absolute inset-0 w-full h-full object-cover"
        data-testid="hero-background-video"
      >
        <source src={heroVideo} type="video/mp4" />
      </video>
      <div className="animated-blob-1" />
      <div className="animated-blob-2" />
      <div className="animated-blob-3" />
    </div>
  );
}
