export function GameViewFooter() {
  return (
    <footer className="game-view-legal-footer">
      <nav className="game-view-footer-links" aria-label="Contact links">
        <a href={`${window.location.pathname}?contact=1`}>Contact us</a>
        <a href="mailto:info@tipinscoring.com">Email TipIn</a>
      </nav>
      <p>
        © 2026 TipIn Scoring. All rights reserved.
        <br />
        TipIn Scoring™ is a trademark of Brad Hermsen.
      </p>
    </footer>
  );
}