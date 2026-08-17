import mongoose from "mongoose";

const ParagraphSchema = new mongoose.Schema(
  {
    index: { type: Number, required: true },
    text: { type: String, default: "" },
  },
  { _id: false }
);

const DocumentSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", index: true, required: true },
    conversationId: { type: mongoose.Schema.Types.ObjectId, ref: "Conversation", index: true, required: true },
    // The user message whose upload this Document was derived from.
    // Nullable at creation time: processFiles() creates this row before the
    // user Message exists (extraction happens before appendMessage runs),
    // then the caller backfills this field once the message is persisted.
    messageId: { type: mongoose.Schema.Types.ObjectId, ref: "Message", index: true, default: null },

    originalFilename: { type: String, required: true },
    originalMimetype: { type: String, required: true },
    sourceFormat: { type: String, enum: ["docx", "pdf", "image"], required: true },

    // Cloudinary raw resource holding the canonical DOCX template —
    // the original file for docx uploads, or the Gotenberg-converted
    // DOCX for pdf/image-origin uploads.
    docxPublicId: { type: String, required: true },
    docxUrl: { type: String, required: true },

    // Paragraph table used for both clause-check prompting and later
    // in-place patching. Index is stable and 0-based across <w:p> elements.
    paragraphs: { type: [ParagraphSchema], default: [] },
  },
  { timestamps: true }
);

export default mongoose.model("Document", DocumentSchema);
