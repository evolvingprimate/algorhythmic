export function AnimatedBackground() {
  return (
    <div className="fixed inset-0 -z-10 overflow-hidden bg-background">
      <div className="animated-gradient-bg" />
      <div className="animated-gradient-overlay" />
      
      <style>{`
        .animated-gradient-bg {
          position: absolute;
          inset: -50%;
          background: linear-gradient(
            135deg,
            rgba(138, 80, 255, 0.15) 0%,
            rgba(138, 80, 255, 0.08) 25%,
            rgba(64, 150, 255, 0.12) 50%,
            rgba(138, 80, 255, 0.18) 75%,
            rgba(100, 100, 255, 0.1) 100%
          );
          background-size: 400% 400%;
          animation: gradientShift 15s ease infinite;
        }
        
        .animated-gradient-overlay {
          position: absolute;
          inset: 0;
          background: 
            radial-gradient(
              circle 800px at 20% 50%,
              rgba(138, 80, 255, 0.2) 0%,
              transparent 50%
            ),
            radial-gradient(
              circle 600px at 80% 80%,
              rgba(64, 150, 255, 0.15) 0%,
              transparent 50%
            ),
            radial-gradient(
              circle 500px at 40% 20%,
              rgba(180, 120, 255, 0.12) 0%,
              transparent 50%
            );
          animation: moveGradient 20s ease infinite;
        }
        
        @keyframes gradientShift {
          0%, 100% {
            background-position: 0% 50%;
          }
          50% {
            background-position: 100% 50%;
          }
        }
        
        @keyframes moveGradient {
          0%, 100% {
            transform: translate(0, 0) scale(1);
          }
          33% {
            transform: translate(30px, -30px) scale(1.1);
          }
          66% {
            transform: translate(-20px, 20px) scale(0.9);
          }
        }
      `}</style>
    </div>
  );
}
