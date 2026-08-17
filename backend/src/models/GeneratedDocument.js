import mongoose from "mongoose";

const GeneratedDocumentSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", index: true, required: true },
    conversationId: { type: mongoose.Schema.Types.ObjectId, ref: "Conversation", index: true, required: true },
    documentId: { type: mongoose.Schema.Types.ObjectId, ref: "Document", index: true, required: true },
    // The assistant message whose clauseAnalysis.issues this generation applied.
    messageId: { type: mongoose.Schema.Types.ObjectId, ref: "Message", index: true, required: true },

    appliedIssueIndices: { type: [Number], default: [] },
    outputFormat: { type: String, enum: ["docx", "pdf"], default: "docx" },

    status: {
      type: String,
      enum: ["pending", "processing", "completed", "failed", "expired"],
      default: "pending",
      index: true,
    },
    errorMessage: { type: String, default: "" },

    resultPublicId: { type: String, default: "" },
    resultUrl: { type: String, default: "" },

    expiresAt: { type: Date, default: null, index: true },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

export default mongoose.model("GeneratedDocument", GeneratedDocumentSchema);
