import mongoose from "mongoose";

const MessageSchema = new mongoose.Schema(
  {
    conversationId: { type: mongoose.Schema.Types.ObjectId, ref: "Conversation", index: true, required: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", index: true, required: true },

    role: { type: String, enum: ["user", "assistant", "system"], required: true },
    content: { type: String, required: true },

    sources: { type: [String], default: [] },
    clauseAnalysis: { type: mongoose.Schema.Types.Mixed, default: null },
    documentText: { type: String, default: "" },
  },
  { timestamps: true }
);

export default mongoose.model("Message", MessageSchema);
