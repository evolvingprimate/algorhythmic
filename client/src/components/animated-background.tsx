import heroImage from "@assets/generated_images/Surreal_flowing_abstract_art_0d26abec.png";

export function AnimatedBackground() {
  return (
    <div className="fixed inset-0 -z-10 overflow-hidden">
      <div 
        className="animated-gradient-bg" 
        style={{ backgroundImage: `url(${heroImage})` }}
      />
      <div className="animated-blob-1" />
      <div className="animated-blob-2" />
      <div className="animated-blob-3" />
    </div>
  );
}
