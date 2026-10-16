export async function POST() {
  return Response.json({ code: "LOCAL_SPEECH_ONLY", message: "Speech runs on your device. Choose a voice in Teacher & voice; no speech API key is needed." }, { status: 410 });
}
