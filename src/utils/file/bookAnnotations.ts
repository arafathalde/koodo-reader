import { saveAs } from "file-saver";
import toast from "react-hot-toast";
import i18n from "../../i18n";
import Book from "../../models/Book";
import DatabaseService from "../storage/databaseService";
import { vexComfirmAsync } from "../common";

// Per-book export / import of highlights, notes and bookmarks.
// One file per book: "<Book name>.annotations.json".
// Records are stored exactly as they are in the database (cfi, range, color,
// tags ...) so that they come back identical after re-importing.

const FORMAT_ID = "koodo-book-annotations";
const FORMAT_VERSION = 1;

interface AnnotationFile {
  format: typeof FORMAT_ID;
  version: number;
  exportedAt: string;
  book: { key: string; name: string; md5: string; format: string };
  notes: any[];
  bookmarks: any[];
}

const safeName = (name: string) =>
  (name || "book").replace(/[\\/:*?"<>|]/g, "_").trim() || "book";

export const exportBookAnnotations = async (
  book: Book
): Promise<"success" | "failed" | "empty"> => {
  try {
    const [notes, bookmarks] = await Promise.all([
      DatabaseService.getRecordsByBookKey(book.key, "notes"),
      DatabaseService.getRecordsByBookKey(book.key, "bookmarks"),
    ]);
    if ((notes?.length ?? 0) + (bookmarks?.length ?? 0) === 0) {
      toast(i18n.t("This book has no notes, highlights or bookmarks"));
      return "empty";
    }
    const data: AnnotationFile = {
      format: FORMAT_ID,
      version: FORMAT_VERSION,
      exportedAt: new Date().toISOString(),
      book: {
        key: book.key,
        name: book.name,
        md5: book.md5,
        format: book.format,
      },
      notes: notes || [],
      bookmarks: bookmarks || [],
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], {
      type: "application/json;charset=UTF-8",
    });
    saveAs(blob, safeName(book.name) + ".annotations.json");
    toast.success(
      i18n.t("Export successful") +
        ` (${data.notes.length} + ${data.bookmarks.length})`
    );
    return "success";
  } catch (error) {
    console.error("Failed to export annotations:", error);
    toast.error(i18n.t("Failed to export"));
    return "failed";
  }
};

const pickJsonFile = (): Promise<string | null> =>
  new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json";
    input.onchange = async (e: any) => {
      const file: File | undefined = e.target.files?.[0];
      if (!file) {
        resolve(null);
        return;
      }
      try {
        resolve(await file.text());
      } catch (error) {
        console.error("Failed to read file:", error);
        resolve(null);
      }
    };
    input.click();
  });

// Writes records for one db, binding them to `book`. Existing keys are
// skipped, so importing the same file twice never creates duplicates.
const saveRecords = async (records: any[], dbName: string, book: Book) => {
  const existing = new Set<string>(
    (await DatabaseService.getAllRecords(dbName)).map((r: any) =>
      String(r.key)
    )
  );
  let imported = 0;
  let skipped = 0;
  for (const record of records) {
    if (!record || !record.key) continue;
    if (existing.has(String(record.key))) {
      skipped++;
      continue;
    }
    await DatabaseService.saveRecord({ ...record, bookKey: book.key }, dbName);
    existing.add(String(record.key));
    imported++;
  }
  return { imported, skipped };
};

export const importBookAnnotations = async (
  book: Book
): Promise<"success" | "failed" | "cancel"> => {
  const text = await pickJsonFile();
  if (text === null) return "cancel";
  let data: AnnotationFile;
  try {
    data = JSON.parse(text);
  } catch (error) {
    toast.error(i18n.t("Invalid data"));
    return "failed";
  }
  if (
    !data ||
    data.format !== FORMAT_ID ||
    !Array.isArray(data.notes) ||
    !Array.isArray(data.bookmarks)
  ) {
    toast.error(i18n.t("Invalid data"));
    return "failed";
  }

  // Warn if the file was exported from a different copy of the book.
  if (data.book?.md5 && book.md5 && data.book.md5 !== book.md5) {
    const proceed = await vexComfirmAsync(
      `<h3>${i18n.t("Different book file")}</h3><p>${i18n.t(
        "These annotations were exported from a different file. Positions may not match. Import anyway?"
      )}</p>`
    );
    if (!proceed) return "cancel";
  }

  try {
    const n = await saveRecords(data.notes, "notes", book);
    const b = await saveRecords(data.bookmarks, "bookmarks", book);
    toast.success(
      `${i18n.t("Import successful")}: ${n.imported + b.imported}` +
        (n.skipped + b.skipped > 0
          ? ` (${n.skipped + b.skipped} ${i18n.t("skipped")})`
          : "")
    );
    return "success";
  } catch (error) {
    console.error("Failed to import annotations:", error);
    toast.error(i18n.t("Failed to import"));
    return "failed";
  }
};
