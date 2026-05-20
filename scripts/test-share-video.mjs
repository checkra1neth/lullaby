// End-to-end test of share video rendering with a real MP3 from Supabase Storage.
// Reproduces the exact ffmpeg invocation from lib/gen/shareVideo.ts.

import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import ffmpegStaticPath from "ffmpeg-static";
import ffmpeg from "fluent-ffmpeg";
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const BUCKET = process.env.SUPABASE_BUCKET_LULLABIES || "lullabies";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

async function main() {
  // 1. Find a recent MP3 in the bucket to test with
  const { data: files, error: listErr } = await supabase.storage
    .from(BUCKET)
    .list("mp3", { limit: 5, sortBy: { column: "created_at", order: "desc" } });

  if (listErr || !files || files.length === 0) {
    console.error("No MP3s found in bucket:", listErr);
    process.exit(1);
  }

  console.log("Available MP3s:", files.map((f) => f.name));
  const testFile = `mp3/${files[0].name}`;
  console.log("Using:", testFile);

  // 2. Get signed URL
  const { data: urlData, error: urlErr } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(testFile, 600);

  if (urlErr || !urlData?.signedUrl) {
    console.error("Signed URL failed:", urlErr);
    process.exit(1);
  }

  console.log("Signed URL ready");

  // 3. Configure ffmpeg
  ffmpeg.setFfmpegPath(ffmpegStaticPath);

  // 4. Run the same filter graph as shareVideo.ts
  const tmpDir = os.tmpdir();
  const outputPath = path.join(tmpDir, `test-share-${Date.now()}.mp4`);

  const t0 = 0;
  const segLen = 15;
  const displayName = "TestChild";

  const filterComplex = [
    `[0:a]atrim=start=${t0}:end=${t0 + segLen},asetpts=PTS-STARTPTS,asplit=2[a_wave][a_out]`,
    `[a_wave]showwaves=mode=cline:rate=24:size=720x320[wave]`,
    `color=c=#0d0a23:size=720x1280:rate=24[bg]`,
    `[bg]drawtext=text='${displayName}':fontsize=64:fontcolor=white:x=(w-text_w)/2:y=200[bg2]`,
    `[bg2][wave]overlay=x=0:y=480[vid]`,
  ].join(";");

  console.log("\nFilter graph:");
  console.log(filterComplex);
  console.log();

  await new Promise((resolve, reject) => {
    let stderr = "";
    ffmpeg()
      .input(urlData.signedUrl)
      .complexFilter(filterComplex)
      .outputOptions([
        "-map", "[vid]",
        "-map", "[a_out]",
        "-c:v", "libx264",
        "-preset", "fast",
        "-crf", "23",
        "-c:a", "aac",
        "-b:a", "128k",
        "-t", String(segLen),
        "-movflags", "+faststart",
        "-pix_fmt", "yuv420p",
      ])
      .on("stderr", (line) => {
        stderr += line + "\n";
        process.stdout.write(".");
      })
      .on("error", (err) => {
        console.error("\n\n=== FFMPEG ERROR ===");
        console.error(err.message);
        console.error("\n=== STDERR TAIL ===");
        console.error(stderr.slice(-3000));
        reject(err);
      })
      .on("end", () => {
        console.log("\n\n=== SUCCESS ===");
        resolve();
      })
      .save(outputPath);
  });

  const stat = await fs.stat(outputPath);
  console.log(`Output: ${outputPath}`);
  console.log(`Size: ${stat.size} bytes`);

  // Cleanup
  await fs.rm(outputPath, { force: true });
  console.log("Cleaned up");
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
