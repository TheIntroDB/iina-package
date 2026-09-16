import React, { useEffect, useState } from "react";

const App = () => {
  const [segment, setSegment] = useState(null);

  useEffect(() => {
    window.iina.onMessage("segment", (data) => setSegment(data));
  }, []);

  if (!segment) return null;

  return (
    <button
      onClick={() => window.iina.postMessage("skip", {})}
      style={{
        position: "fixed",
        right: "24px",
        bottom: "72px",
        padding: "10px 20px",
        background: "rgba(20,20,20,0.85)",
        color: "#fff",
        border: "1px solid rgba(255,255,255,0.3)",
        borderRadius: "4px",
        fontSize: "14px",
        cursor: "pointer",
      }}
    >
      Skip {segment.label}
    </button>
  );
};

export default App;