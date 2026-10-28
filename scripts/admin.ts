// Interactive admin menu. Each action runs the existing CLI script, so behavior stays the same as
// calling it directly (bun run review / check-instagram / pipeline --once / schedule / reset).
// Usage: bun scripts/admin.ts
import { DEFAULT_TARGET_USERNAME } from "../src/instagram/client";
import { runTimesInput } from "../src/pipeline/schedule";

const run = (script: string, ...args: string[]) =>
  Bun.spawn(["bun", `scripts/${script}.ts`, ...args], { cwd: `${import.meta.dir}/..`, stdio: ["inherit", "inherit", "inherit"] }).exited;

// Reads a whole line; Bun's confirm() reads one character and leaves the Enter for the next prompt.
const askYes = (question: string) => /^(y|ya|yes)$/i.test((prompt(`${question} [y/N]`) ?? "").trim());

// "a1b2c3d4, e5f6a7b8 c9d0" -> ["a1b2c3d4", "e5f6a7b8", "c9d0"]
const askIds = (question: string) => (prompt(question) ?? "").split(/[\s,]+/).filter(Boolean);

// Numbered choice; undefined when the answer is not one of the options.
function choose<T>(title: string, options: [string, T][]): T | undefined {
  console.log(`\n${title}`);
  options.forEach(([label], i) => console.log(`${i + 1}. ${label}`));
  return options[Number((prompt("Pilih:") ?? "").trim()) - 1]?.[1];
}

// Asks for a username and shows its profile; undefined when it cannot be read.
async function askCheckedAccount(defaultName = DEFAULT_TARGET_USERNAME) {
  const username = (prompt("Username Instagram:", defaultName) ?? "").trim().replace(/^@/, "");
  if (!username) return undefined;
  console.log();
  return (await run("check-instagram", username)) === 0 ? username : undefined;
}

const askPublishMode = () =>
  choose("Lowongan hasil ekstraksi:", [
    ["Langsung publish (tayang di website)", "--publish"],
    ["Simpan sebagai draft (review dulu)", "--draft"],
  ]);

const actions: { label: string; action: () => Promise<unknown> }[] = [
  { label: "Ringkasan data", action: () => run("review", "stats") },
  { label: "Lihat draft", action: () => run("review") },
  {
    label: "Lowongan yang baru tayang",
    action: () => run("review", "recent", prompt("Berapa hari terakhir?", "3") ?? "3"),
  },
  {
    label: "Detail lowongan",
    action: async () => {
      const [id] = askIds("ID lowongan:");
      if (id) await run("review", "show", id);
    },
  },
  {
    label: "Publish lowongan",
    action: async () => {
      const ids = askIds("ID yang akan di-publish (pisahkan dengan spasi):");
      if (ids.length) await run("review", "publish", ...ids);
    },
  },
  {
    label: "Sembunyikan (reject) lowongan",
    action: async () => {
      const ids = askIds("ID yang akan disembunyikan (pisahkan dengan spasi):");
      if (ids.length) await run("review", "reject", ...ids);
    },
  },
  {
    label: "Ambil lowongan dari akun Instagram",
    action: async () => {
      const username = await askCheckedAccount();
      if (!username) return;
      const days = choose("Ambil postingan dari:", [
        ["1 hari terakhir", 1],
        ["7 hari terakhir", 7],
        ["1 bulan terakhir (30 hari)", 30],
      ]);
      if (!days) return console.log("Dibatalkan.");
      const mode = askPublishMode();
      if (!mode) return console.log("Dibatalkan.");

      const target = mode === "--publish" ? "langsung publish" : "simpan sebagai draft";
      if (!askYes(`Ambil postingan @${username} ${days} hari terakhir, ekstrak dengan Gemini (memakai kuota), lalu ${target}?`)) {
        return console.log("Dibatalkan.");
      }
      await run("pipeline", "--once", "--account", username, "--days", String(days), mode);
      if (mode === "--draft") console.log("Cek draft lewat menu 2, lalu publish lewat menu 5.");
    },
  },
  {
    label: "Jadwal otomatis (ambil lowongan tiap jam tertentu)",
    action: async () => {
      if ((await run("schedule")) !== 0) return;
      const next = choose("Jadwal otomatis:", [
        ["Atur jadwal (akun, jam, publish/draft)", "set"],
        ["Aktifkan", "enable"],
        ["Matikan", "disable"],
        ["Kembali", "back"],
      ]);
      if (next === "enable" || next === "disable") await run("schedule", next);
      if (next !== "set") return;

      const username = await askCheckedAccount();
      if (!username) return;
      let times: string[] | undefined;
      while (!times) {
        const input = (prompt("\nJam ambil data (WITA), pisahkan dengan koma, mis. 07:00,12:00,19:00 (kosong = batal):") ?? "").trim();
        if (!input) return console.log("Dibatalkan.");
        const parsed = runTimesInput.safeParse(input);
        if (parsed.success) times = parsed.data;
        else console.log(`Format jam salah: ${parsed.error.issues[0]?.message}. Contoh: 07:00,19:30`);
      }
      console.log(`Jam: ${times.join(", ")} WITA`);
      const mode = askPublishMode();
      if (!mode) return console.log("Dibatalkan.");
      await run("schedule", "set", "--account", username, "--times", times.join(","), mode);
    },
  },
  {
    label: "Reset database (hapus SEMUA jobs + source_posts)",
    action: async () => {
      if ((await run("reset")) !== 0) return;
      if (prompt("Ketik HAPUS untuk menghapus semuanya:") === "HAPUS") await run("reset", "--yes");
      else console.log("Dibatalkan, tidak ada yang dihapus.");
    },
  },
];

while (true) {
  console.log("\n=== Loker Lombok admin ===");
  actions.forEach((a, i) => console.log(`${i + 1}. ${a.label}`));
  console.log("0. Keluar");

  const choice = prompt("Pilih:");
  if (choice === null || choice.trim() === "0") break; // null: Ctrl+D / end of input
  const item = actions[Number(choice) - 1];
  if (!item) {
    console.log("Pilihan tidak dikenal.");
    continue;
  }
  console.log();
  await item.action();
}
