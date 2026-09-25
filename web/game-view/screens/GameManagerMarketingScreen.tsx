import { FormEvent, useState } from "react";
import loginImage from "../assets/TipIn Game Manager/01_TipIn Game Manager_tablet login page-cropped.jpg";
import dashboardImage from "../assets/TipIn Game Manager/05_TipIn Game Manager_GameDashboard.jpg";
import activeClockImage from "../assets/TipIn Game Manager/06_TipIn Game Manager_GameDashboard_ActiveClock.jpg";
import rosterImage from "../assets/TipIn Game Manager/02_TipIn Game Manager_VerifyRoster.jpg";
import officialsImage from "../assets/TipIn Game Manager/03_TipIn Game Manager_VerifyOfficials.jpg";
import goalImage from "../assets/TipIn Game Manager/11_TipIn Game Manager_GameDashboard_ AddGoalEvent.jpg";
import penaltyImage from "../assets/TipIn Game Manager/09_TipIn Game Manager_GameDashboard_ GameFeed_AddPenaltyEvent.jpg";
import scoresheetImage from "../assets/TipIn Game Manager/13_TipIn Game Manager_GameDashboard_GameEmailSUmmary.jpg";
import adminImage from "../assets/TipIn Game Manager/TipIn Admin Portal Menu.png";
import { GameViewFooter } from "../components/GameViewFooter";
import { submitGameManagerPilotInterest } from "../api/gameViewApi";

function returnToGameView() {
  window.location.assign(window.location.pathname);
}

export function GameManagerMarketingScreen() {
  const [form, setForm] = useState({
    organizationName: "",
    contactName: "",
    email: "",
    contactRole: "",
    teamCount: "",
    gatewayInterest: "unsure" as "interested" | "unsure" | "not-now",
    notes: "",
    website: "",
  });
  const [submissionState, setSubmissionState] = useState<
    "idle" | "submitting" | "success" | "error"
  >("idle");
  const [submissionMessage, setSubmissionMessage] = useState("");

  async function submitPilotForm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmissionState("submitting");
    setSubmissionMessage("");
    try {
      const message = await submitGameManagerPilotInterest({
        ...form,
        teamCount: form.teamCount ? Number(form.teamCount) : null,
      });
      setSubmissionState("success");
      setSubmissionMessage(message);
    } catch (error) {
      setSubmissionState("error");
      setSubmissionMessage(
        error instanceof Error
          ? error.message
          : "Unable to submit pilot interest.",
      );
    }
  }

  return (
    <main className="game-manager-marketing-root">
      <nav
        className="game-manager-marketing-nav"
        aria-label="Product navigation"
      >
        <button
          type="button"
          className="game-manager-marketing-back"
          onClick={returnToGameView}
        >
          Back to GameView
        </button>
        <img
          src="/TipIn_Header_Mark.svg"
          alt="TipIn Scoring"
          className="game-manager-marketing-mark"
        />
        <a className="game-manager-marketing-nav-cta" href="#workflow">
          See the workflow
        </a>
      </nav>

      <section className="game-manager-marketing-hero">
        <img
          src={dashboardImage}
          alt="TipIn Game Manager live game dashboard"
        />
        <div className="game-manager-marketing-hero-shade" />
        <div className="game-manager-marketing-hero-content">
          <p className="game-manager-marketing-eyebrow">
            The control room behind GameView
          </p>
          <p className="game-manager-pilot-badge">Pilot season · 2026–2027</p>
          <h1>TipIn Game Manager</h1>
          <p className="game-manager-marketing-hook">
            Every score fans see starts here.
          </p>
          <p className="game-manager-marketing-lede">
            One focused game-day workspace for rosters, officials, clock
            control, scoring, penalties, shots, and the final scoresheet.
          </p>
          <a className="game-manager-marketing-primary" href="#workflow">
            Follow a game from check-in to final
          </a>
        </div>
      </section>

      <section id="workflow" className="game-manager-marketing-intro">
        <p className="game-manager-marketing-eyebrow">
          Built for the person at the table
        </p>
        <h2>Less switching. Fewer loose ends. A cleaner game.</h2>
        <p>
          Game Manager turns the scorer's table into the source of truth. What
          gets entered during the game flows into GameView, official records,
          and the final report.
        </p>
      </section>

      <section className="game-manager-pilot-band">
        <div>
          <p className="game-manager-marketing-eyebrow">
            Now forming the first lineup
          </p>
          <h2>Built with pilot teams, not around them.</h2>
        </div>
        <p>
          The 2026–2027 season is TipIn Game Manager's pilot year. Participating
          teams help shape the game-day workflow while receiving guided setup
          and direct support.
        </p>
        <a className="game-manager-marketing-primary" href="#pilot-interest">
          Join the pilot conversation
        </a>
      </section>

      <section className="game-manager-feature-focus">
        <div className="game-manager-feature-focus-image">
          <img
            src={loginImage}
            alt="TipIn Game Manager secure access-code login"
          />
        </div>
        <div className="game-manager-marketing-step-copy">
          <span>Secure access</span>
          <h2>
            Get the right person into the right game without another password.
          </h2>
          <p>
            Game Managers log in with a unique access code provided by the
            organization administrator — no passwords, no friction. Enter the
            code and the scheduled game is ready to manage.
          </p>
        </div>
      </section>

      <section className="game-manager-marketing-step">
        <div className="game-manager-marketing-step-copy">
          <span>01 / Before puck drop</span>
          <h2>Start with the people who are actually in the building.</h2>
          <p>
            Verify active rosters and starters, confirm coaches, assign
            officials, and capture signatures before the clock starts.
          </p>
          <ul>
            <li>Game-specific roster verification</li>
            <li>Starter and goalie confirmation</li>
            <li>Official selection, replacement, and sign-off</li>
          </ul>
        </div>
        <div className="game-manager-marketing-device-pair">
          <figure>
            <img
              src={rosterImage}
              alt="Roster verification in TipIn Game Manager"
            />
            <figcaption>Roster verification</figcaption>
          </figure>
          <figure>
            <img
              src={officialsImage}
              alt="Official verification in TipIn Game Manager"
            />
            <figcaption>Official sign-off</figcaption>
          </figure>
        </div>
      </section>

      <section className="game-manager-marketing-step game-manager-marketing-step-reverse game-manager-marketing-step-gameplay">
        <div className="game-manager-marketing-step-copy">
          <span>02 / During the game</span>
          <h2>Record the moment once. Let the system carry it.</h2>
          <p>
            Goals, penalties, shots, goalie changes, and timeouts are captured
            beside the live game clock. The event feed stays available for
            correction and review.
          </p>
          <ul>
            <li>Live scoreboard and clock workflow</li>
            <li>Fast event entry with player context</li>
            <li>Immediate GameView updates for fans</li>
          </ul>
        </div>
        <div className="game-manager-marketing-device-pair game-manager-marketing-device-pair-large">
          <figure>
            <img src={goalImage} alt="Adding a goal in TipIn Game Manager" />
            <figcaption>Goal entry</figcaption>
          </figure>
          <figure>
            <img
              src={penaltyImage}
              alt="Adding a penalty in TipIn Game Manager"
            />
            <figcaption>Penalty entry</figcaption>
          </figure>
        </div>
      </section>

      <section className="game-manager-feature-focus game-manager-feature-focus-reverse">
        <div className="game-manager-feature-focus-image game-manager-feature-focus-image-wide">
          <img
            src={activeClockImage}
            alt="TipIn Game Manager active clock and period tracking dashboard"
          />
        </div>
        <div className="game-manager-marketing-step-copy">
          <span>Active clock &amp; period tracking</span>
          <h2>The game state stays visible while the game keeps moving.</h2>
          <p>
            With the clock running, period progression and strength situation —
            Even Strength, Power Play, or Short-Handed — update automatically.
            Live game state flows to TipIn GameView as the action unfolds.
          </p>
        </div>
      </section>

      <section className="game-manager-marketing-closeout">
        <div className="game-manager-marketing-closeout-image">
          <img
            src={scoresheetImage}
            alt="Sending the final scoresheet from TipIn Game Manager"
          />
        </div>
        <div className="game-manager-marketing-step-copy">
          <span>03 / At the final horn</span>
          <h2>The game ends. The paperwork does too.</h2>
          <p>
            Review the final, route the scoresheet to coaches, officials, and
            media, then close the game with the record already assembled.
          </p>
        </div>
      </section>

      <section className="game-manager-marketing-admin">
        <div className="game-manager-marketing-admin-copy">
          <p className="game-manager-marketing-eyebrow">
            The season behind game day
          </p>
          <h2>
            Admin tools that set the table before anyone reaches the rink.
          </h2>
          <p>
            Organizations, teams, schedules, arenas, rosters, officials, users,
            and season settings live in one operational portal.
          </p>
        </div>
        <img
          src={adminImage}
          alt="TipIn Game Manager Admin Portal navigation"
        />
      </section>

      <section className="game-manager-gateway-section">
        <div className="game-manager-gateway-copy">
          <p className="game-manager-marketing-eyebrow">
            Optional rink-side connection
          </p>
          <h2>Run it with the TipIn Gateway. Or run it without one.</h2>
          <p>
            Game Manager works on an Android tablet as a complete manual
            game-day system. Add the optional TipIn Scoring Gateway when you
            want the tablet connected to a compatible arena scoreboard
            controller.
          </p>
        </div>
        <div
          className="game-manager-gateway-paths"
          aria-label="Game Manager operating options"
        >
          <div className="game-manager-gateway-path">
            <span>Tablet only</span>
            <strong>Game Manager</strong>
            <p>
              Run the clock and enter game events directly from the Android
              tablet.
            </p>
          </div>
          <div className="game-manager-gateway-connector" aria-hidden="true">
            or
          </div>
          <div className="game-manager-gateway-path game-manager-gateway-path-accent">
            <span>Connected setup</span>
            <strong>Game Manager + TipIn Gateway</strong>
            <p>
              Connect compatible scoreboard data while keeping the same operator
              workflow.
            </p>
          </div>
        </div>
      </section>

      <section id="pilot-interest" className="game-manager-marketing-final-cta">
        <div className="game-manager-pilot-form-intro">
          <p className="game-manager-marketing-eyebrow">
            2026–2027 pilot season
          </p>
          <h2>Ready to Modernize Your Game Management?</h2>
          <p>
            TipIn Game Manager works with TipIn GameView and the Admin Portal to
            give your organization a complete, connected hockey management
            platform — running on Android tablets, powered by the optional TipIn
            Scoring Gateway.
          </p>
        </div>
        <form className="game-manager-pilot-form" onSubmit={submitPilotForm}>
          <div className="game-manager-pilot-field">
            <label htmlFor="pilot-organization">Organization</label>
            <input
              id="pilot-organization"
              required
              value={form.organizationName}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  organizationName: event.target.value,
                }))
              }
            />
          </div>
          <div className="game-manager-pilot-field">
            <label htmlFor="pilot-contact">Your name</label>
            <input
              id="pilot-contact"
              required
              value={form.contactName}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  contactName: event.target.value,
                }))
              }
            />
          </div>
          <div className="game-manager-pilot-field">
            <label htmlFor="pilot-email">Email</label>
            <input
              id="pilot-email"
              type="email"
              required
              value={form.email}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  email: event.target.value,
                }))
              }
            />
          </div>
          <div className="game-manager-pilot-field">
            <label htmlFor="pilot-role">Your role</label>
            <input
              id="pilot-role"
              placeholder="Coach, AD, association lead..."
              value={form.contactRole}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  contactRole: event.target.value,
                }))
              }
            />
          </div>
          <div className="game-manager-pilot-field">
            <label htmlFor="pilot-teams">Number of teams</label>
            <input
              id="pilot-teams"
              type="number"
              min="1"
              max="500"
              value={form.teamCount}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  teamCount: event.target.value,
                }))
              }
            />
          </div>
          <div className="game-manager-pilot-field">
            <label htmlFor="pilot-gateway">TipIn Gateway</label>
            <select
              id="pilot-gateway"
              value={form.gatewayInterest}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  gatewayInterest: event.target
                    .value as typeof current.gatewayInterest,
                }))
              }
            >
              <option value="interested">Interested in the Gateway</option>
              <option value="unsure">Not sure yet</option>
              <option value="not-now">Game Manager without Gateway</option>
            </select>
          </div>
          <div className="game-manager-pilot-field game-manager-pilot-field-wide">
            <label htmlFor="pilot-notes">What would you like to improve?</label>
            <textarea
              id="pilot-notes"
              rows={3}
              value={form.notes}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  notes: event.target.value,
                }))
              }
            />
          </div>
          <div className="game-manager-pilot-honeypot" aria-hidden="true">
            <label htmlFor="pilot-website">Website</label>
            <input
              id="pilot-website"
              tabIndex={-1}
              autoComplete="off"
              value={form.website}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  website: event.target.value,
                }))
              }
            />
          </div>
          <div className="game-manager-pilot-submit-row">
            <button
              type="submit"
              className="game-manager-marketing-primary"
              disabled={submissionState === "submitting"}
            >
              {submissionState === "submitting"
                ? "Sending..."
                : "Tell us you're interested"}
            </button>
            {submissionMessage ? (
              <p
                className={`game-manager-pilot-status ${submissionState}`}
                role="status"
              >
                {submissionMessage}
              </p>
            ) : null}
          </div>
          <p className="game-manager-pilot-privacy">
            We’ll use these details only to contact you about the 2026–2027
            TipIn Game Manager pilot.
          </p>
        </form>
      </section>

      <GameViewFooter />
    </main>
  );
}
