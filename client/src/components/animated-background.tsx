export function AnimatedBackground() {
  return (
    <div className="fixed inset-0 -z-10 overflow-hidden">
      <div className="animated-gradient-bg" />
      <div className="animated-blob-1" />
      <div className="animated-blob-2" />
      <div className="animated-blob-3" />
    </div>
  );
}
