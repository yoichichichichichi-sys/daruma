// 作曲アシスタント: 曲の分析と、次の一手の提案。

import { BEATS_PER_BAR, keyNameJa, scalePcs, mod, midiToName, chordPcs, suggestNextChords, findProgressions, progressionToChords, detectKey, keyName } from "./theory.js";
import { sortChords, chordAt } from "./generate.js";

/**
 * 曲を分析して所見と提案を返す
 * @returns {{summary:string[], issues:string[], ideas:{label:string, command:string}[]}}
 */
export function analyzeProject(p) {
  const summary = [];
  const issues = [];
  const ideas = [];
  const scale = scalePcs(p.key);
  const chords = sortChords(p.chords);

  summary.push(`キー: ${keyNameJa(p.key)} / テンポ: ${p.bpm} BPM / 長さ: ${p.bars} 小節`);
  if (chords.length) summary.push(`コード: ${chords.map((c) => c.symbol).join(" → ")}`);
  else {
    issues.push("コード進行がまだありません。");
    ideas.push({ label: "定番の進行を入れる", command: "切ない進行を作って" });
  }

  const pitched = p.tracks.filter((t) => t.instrument !== "drums");
  const allNotes = pitched.flatMap((t) => t.notes);
  if (allNotes.length > 8) {
    const guess = detectKey(allNotes);
    if (guess && (guess.root !== p.key.root || guess.mode !== p.key.mode)) {
      summary.push(`ノートの分布からは ${keyNameJa(guess)} にも聞こえます（設定キー: ${keyNameJa(p.key)}）。`);
      ideas.push({ label: `キーを ${keyName(guess)} にする`, command: `キーを${keyName(guess)}に` });
    }
  }

  for (const t of p.tracks) {
    const label = `「${t.name}」`;
    if (!t.notes.length) {
      summary.push(`${label}: 空`);
      continue;
    }
    if (t.instrument === "drums") {
      summary.push(`${label}: ${t.notes.length} 打`);
      continue;
    }
    const pitches = t.notes.map((n) => n.pitch);
    const lo = Math.min(...pitches);
    const hi = Math.max(...pitches);
    const outOfKey = t.notes.filter((n) => !scale.includes(mod(n.pitch, 12)));
    summary.push(`${label}: ${t.notes.length} ノート, 音域 ${midiToName(lo, p.key)}〜${midiToName(hi, p.key)}`);
    if (outOfKey.length && outOfKey.length / t.notes.length > 0.15) {
      issues.push(`${label} にキー外の音が ${outOfKey.length} 個あります（意図的でなければ修正を）。`);
    }
    // コードとぶつかる長い音（強拍のアボイドノート的なもの）
    if (chords.length && t.instrument !== "bass") {
      const clashes = t.notes.filter((n) => {
        if (n.duration < 1 || n.start % 2 !== 0) return false;
        const c = chordAt(chords, n.start);
        if (!c) return false;
        const pcs = chordPcs(c.symbol);
        const pc = mod(n.pitch, 12);
        // コードトーンの半音上（短9度）は強くぶつかる
        return pcs.some((cp) => mod(pc - cp, 12) === 1) && !pcs.includes(pc);
      });
      if (clashes.length) issues.push(`${label} の強拍の長い音 ${clashes.length} 個がコードと半音でぶつかっています（例: ${(clashes[0].start / BEATS_PER_BAR + 1).toFixed(0)} 小節目 ${midiToName(clashes[0].pitch, p.key)}）。`);
    }
    if (hi - lo > 24 && t.instrument !== "piano") issues.push(`${label} の音域が 2 オクターブを超えています。歌うなら狭めると歌いやすくなります。`);
  }

  const has = (inst) => p.tracks.some((t) => t.instrument === inst && t.notes.length);
  const byName = (re) => p.tracks.some((t) => re.test(t.name) && t.notes.length);
  if (chords.length && !byName(/メロ|lead|melody/i) && !has("lead")) ideas.push({ label: "メロディを生成", command: "メロディを作って" });
  if (chords.length && !has("bass")) ideas.push({ label: "ベースを付ける", command: "ベースを8分で" });
  if (!has("drums")) ideas.push({ label: "ドラムを入れる", command: "ドラムを入れて" });
  if (chords.length) {
    const last = chords[chords.length - 1].symbol;
    for (const s of suggestNextChords(last, p.key).slice(0, 2)) {
      ideas.push({ label: `${last} の次に ${s.chord}（${s.reason}）`, command: `コード追加 ${s.chord}` });
    }
  }
  if (p.bars <= 8 && chords.length) ideas.push({ label: "サビ用に16小節へ拡張", command: "16小節にして" });

  return { summary, issues, ideas };
}

/** ムードから進行候補を作る（キーに合わせて具体的なコード名に） */
export function suggestProgressions(mood, key) {
  return findProgressions(mood)
    .slice(0, 6)
    .map((prog) => {
      const k = prog.mode === key.mode ? key : relativeKey(key);
      return { id: prog.id, name: prog.name, key: k, roman: prog.roman, chords: progressionToChords(prog, k), mood: prog.mood };
    });
}

/** 平行調 */
export function relativeKey(key) {
  return key.mode === "major" ? { root: mod(key.root + 9, 12), mode: "minor" } : { root: mod(key.root + 3, 12), mode: "major" };
}
