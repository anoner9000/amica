import Link from "next/link";

export default function NotFound() {
  return (
    <div style={{
      minHeight: "100vh",
      backgroundColor: "#0f0d0b",
      display: "flex",
      alignItems: "stretch",
      fontFamily: "'Georgia', 'Times New Roman', serif",
    }}>
      {/* Left: text content */}
      <div style={{
        flex: "1 1 0",
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        alignItems: "center",
        textAlign: "center",
        padding: "4rem clamp(2rem, 6vw, 6rem)",
      }}>
        <p style={{
          color: "#c8aa6e",
          fontSize: "0.7rem",
          letterSpacing: "0.25em",
          textTransform: "uppercase",
          marginBottom: "0.25rem",
        }}>
          Deiphobe
        </p>
        <p style={{
          color: "#9a8878",
          fontSize: "0.6rem",
          letterSpacing: "0.15em",
          textTransform: "uppercase",
          marginBottom: "2.5rem",
        }}>
          AI Core &amp; Confidant
        </p>

        <h1 style={{
          color: "#c8aa6e",
          fontSize: "clamp(5rem, 12vw, 8rem)",
          fontWeight: 700,
          lineHeight: 1,
          margin: "0 0 0.5rem",
          letterSpacing: "-0.02em",
        }}>
          404
        </h1>

        <p style={{
          color: "#d4b896",
          fontSize: "clamp(0.9rem, 2vw, 1.1rem)",
          letterSpacing: "0.15em",
          textTransform: "uppercase",
          margin: "0 0 1.25rem",
        }}>
          Page not found
        </p>

        <p style={{
          color: "#6e5f52",
          fontSize: "0.85rem",
          lineHeight: 1.7,
          marginBottom: "2.5rem",
        }}>
          The page you&apos;re looking for doesn&apos;t exist or may have moved.
        </p>

        <Link
          href="/"
          style={{
            display: "inline-block",
            border: "1px solid #c8aa6e",
            color: "#c8aa6e",
            padding: "0.65rem 2rem",
            fontSize: "0.7rem",
            letterSpacing: "0.2em",
            textTransform: "uppercase",
            textDecoration: "none",
            transition: "background 0.2s, color 0.2s",
          }}
          onMouseEnter={e => {
            (e.currentTarget as HTMLAnchorElement).style.background = "#c8aa6e";
            (e.currentTarget as HTMLAnchorElement).style.color = "#0f0d0b";
          }}
          onMouseLeave={e => {
            (e.currentTarget as HTMLAnchorElement).style.background = "transparent";
            (e.currentTarget as HTMLAnchorElement).style.color = "#c8aa6e";
          }}
        >
          Return Home
        </Link>
      </div>

      {/* Right: character image */}
      <div style={{
        flex: "0 0 clamp(280px, 42vw, 560px)",
        position: "relative",
        overflow: "hidden",
      }}>
        <img
          src="/deiphobe-404.png"
          alt="Deiphobe"
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            objectFit: "cover",
            objectPosition: "center top",
          }}
        />
        {/* Fade the left edge into the background */}
        <div style={{
          position: "absolute",
          inset: 0,
          background: "linear-gradient(to right, #0f0d0b 0%, transparent 30%)",
          pointerEvents: "none",
        }} />
      </div>
    </div>
  );
}
