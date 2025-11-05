export function AnimatedBackground() {
  return (
    <div className="fixed inset-0 -z-10 overflow-hidden">
      <div className="animated-gradient-bg" />
      <div className="animated-gradient-overlay" />
      
      <style>{`
        .animated-gradient-bg {
          position: absolute;
          inset: -50%;
          background: linear-gradient(
            45deg,
            hsl(var(--primary) / 0.3),
            hsl(var(--primary) / 0.15),
            hsl(var(--accent) / 0.3),
            hsl(var(--primary) / 0.2)
          );
          background-size: 400% 400%;
          animation: gradientShift 15s ease infinite;
        }
        
        .animated-gradient-overlay {
          position: absolute;
          inset: 0;
          background: radial-gradient(
            circle at 20% 50%,
            hsl(var(--primary) / 0.2) 0%,
            transparent 50%
          ),
          radial-gradient(
            circle at 80% 80%,
            hsl(var(--accent) / 0.15) 0%,
            transparent 50%
          ),
          radial-gradient(
            circle at 40% 20%,
            hsl(var(--primary) / 0.1) 0%,
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
