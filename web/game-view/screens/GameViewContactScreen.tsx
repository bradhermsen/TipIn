import { FormEvent, useState } from "react";
import { GameViewFooter } from "../components/GameViewFooter";
import { submitGameViewContact } from "../api/gameViewApi";

type ContactForm = {
  name: string;
  email: string;
  subject: string;
  message: string;
  website: string;
};

const emptyForm: ContactForm = {
  name: "",
  email: "",
  subject: "",
  message: "",
  website: "",
};

export function GameViewContactScreen() {
  const [form, setForm] = useState<ContactForm>(emptyForm);
  const [status, setStatus] = useState<"idle" | "submitting" | "success" | "error">("idle");
  const [statusMessage, setStatusMessage] = useState("");

  function updateField(field: keyof ContactForm, value: string) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus("submitting");
    setStatusMessage("");
    try {
      const message = await submitGameViewContact(form);
      setStatus("success");
      setStatusMessage(message);
      setForm(emptyForm);
    } catch (error) {
      setStatus("error");
      setStatusMessage(error instanceof Error ? error.message : "Unable to send your message.");
    }
  }

  return (
    <main className="game-view-contact-root">
      <header className="game-view-contact-header">
        <a className="game-view-contact-back" href={window.location.pathname}>Back to Game View</a>
        <h1>Contact TipIn</h1>
        <p>Send us a message and we’ll get back to you.</p>
      </header>

      <form className="game-view-contact-form" onSubmit={submit}>
        <div className="game-view-contact-field">
          <label htmlFor="contact-name">Name</label>
          <input id="contact-name" autoComplete="name" maxLength={160} required value={form.name} onChange={(event) => updateField("name", event.target.value)} />
        </div>
        <div className="game-view-contact-field">
          <label htmlFor="contact-email">Email</label>
          <input id="contact-email" type="email" autoComplete="email" maxLength={255} required value={form.email} onChange={(event) => updateField("email", event.target.value)} />
        </div>
        <div className="game-view-contact-field game-view-contact-field-wide">
          <label htmlFor="contact-subject">Subject</label>
          <input id="contact-subject" maxLength={160} required value={form.subject} onChange={(event) => updateField("subject", event.target.value)} />
        </div>
        <div className="game-view-contact-field game-view-contact-field-wide">
          <label htmlFor="contact-message">Message</label>
          <textarea id="contact-message" maxLength={3000} required rows={7} value={form.message} onChange={(event) => updateField("message", event.target.value)} />
        </div>
        <div className="game-view-contact-honeypot" aria-hidden="true">
          <label htmlFor="contact-website">Website</label>
          <input id="contact-website" tabIndex={-1} autoComplete="off" value={form.website} onChange={(event) => updateField("website", event.target.value)} />
        </div>
        <div className="game-view-contact-submit-row">
          <button className="game-manager-marketing-primary" type="submit" disabled={status === "submitting"}>
            {status === "submitting" ? "Sending..." : "Send message"}
          </button>
          {statusMessage ? <p className={`game-view-contact-status ${status}`} role="status">{statusMessage}</p> : null}
        </div>
        <p className="game-view-contact-email">Or email us directly at <a href="mailto:info@tipinscoring.com">info@tipinscoring.com</a>.</p>
        <p className="game-view-contact-pilot">Interested in Game Manager? <a href={`${window.location.pathname}?about=game-manager`}>View the pilot information</a>.</p>
      </form>

      <GameViewFooter />
    </main>
  );
}
