import heroVideo from "@assets/Surreal_flowing_abstract_art_video_2_1762650434281.mp4";
import heroImage from "@assets/generated_images/Surreal_flowing_abstract_art_0d26abec.png";

export function AnimatedBackground() {
  return (
    <div className="fixed inset-0 -z-10 overflow-hidden">
      <video
        autoPlay
        loop
        muted
        playsInline
        preload="auto"
        disablePictureInPicture
        disableRemotePlayback
        poster={heroImage}
        aria-hidden="true"
        className="absolute inset-0 w-full h-full object-cover"
        style={{
          willChange: 'transform',
          transform: 'translateZ(0)',
        }}
        data-testid="hero-background-video"
      >
        <source src={heroVideo} type="video/mp4" />
      </video>
    </div>
  );
}
