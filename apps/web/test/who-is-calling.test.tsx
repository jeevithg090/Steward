import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { WhoIsCalling } from "@/components/WhoIsCalling";
import type { VoiceProfileView } from "@/lib/api";

const view = (over: Partial<VoiceProfileView["profile"]>, extra: Partial<VoiceProfileView> = {}): VoiceProfileView => ({
  user_id: "u_dilip", display_name: "Dilip", adjusted: true,
  how_to_speak: "Speak Hindi unless they switch. Speak slowly, with short pauses.",
  profile: {
    language: "hi", speed: "0.85", voice: "default", patience: "normal", stammer: false, hearing: false,
    prefers_text: false, other_language: null, keywords: ["Reading", "Paddington"],
    reasons: ["speaks Hindi", "wants slower speech"], ...over,
  },
  initiation: {
    type: "conversation_initiation_client_data",
    dynamic_variables: { caller_id: "u_dilip" },
    conversation_config_override: {
      agent: { language: "hi", first_message: "नमस्ते, मैं Tempo हूँ, एक AI सहायक।" },
      tts: { speed: 0.85 },
      asr: { keywords: ["Reading", "Paddington", "Tempo"] },
    },
  },
  low_voice_configured: false,
  ...extra,
});

test("shows how Tempo will speak with the caller, and why", async () => {
  render(<WhoIsCalling load={async () => view({})} />);

  expect(await screen.findByText("Hindi")).toBeInTheDocument();
  expect(screen.getByText("Slower (0.85×)")).toBeInTheDocument();
  expect(screen.getByText(/Speak Hindi unless they switch/)).toBeInTheDocument();
  expect(screen.getByText(/नमस्ते/)).toHaveAttribute("lang", "hi");
  const heard = screen.getByRole("list", { name: "Words it listens out for" });
  expect(within(heard).getByText("Paddington")).toBeInTheDocument();
  const why = screen.getByRole("list", { name: "Because they said" });
  expect(within(why).getByText("wants slower speech")).toBeInTheDocument();
});

test("switching caller loads their settings; a missing low voice is said out loud", async () => {
  const asked: string[] = [];
  const joan = view(
    { language: "en", speed: "0.9", voice: "low", hearing: true, prefers_text: true, keywords: [], reasons: ["is hard of hearing"] },
    { user_id: "u_joan", how_to_speak: "They find it hard to hear.", initiation: { type: "x", dynamic_variables: {} } },
  );
  render(<WhoIsCalling load={async (id) => { asked.push(id); return id === "u_joan" ? joan : view({}); }} />);

  await screen.findByText("Hindi");
  await userEvent.click(screen.getByRole("button", { name: "Joan" }));

  expect(await screen.findByText(/Tempo, lower/)).toHaveTextContent("not set up yet");
  expect(screen.getByText("Offered by text too")).toBeInTheDocument();
  expect(asked).toEqual(["u_margaret", "u_joan"]);
  expect(document.body.textContent).not.toMatch(/voice_/); // never a voice id
});

test("a live call shows who was just answered, and how", async () => {
  const events = [{ type: "profile_applied", user_id: "u_dilip", language: "hi", speed: "0.85", voice: "default", patience: "normal" }];
  render(<WhoIsCalling load={async () => view({})} events={events} />);

  expect(await screen.findByRole("status")).toHaveTextContent("Last call: Dilip, in Hindi, slower");
});

test("a caller with nothing remembered gets the usual voice, and says so", async () => {
  render(<WhoIsCalling load={async () => view({ language: "en", speed: "1.0", keywords: [], reasons: [] }, { adjusted: false, initiation: { type: "x", dynamic_variables: {} } })} />);

  expect(await screen.findByText(/Nothing yet, so Tempo's usual patient voice/)).toBeInTheDocument();
});
