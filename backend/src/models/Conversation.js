import mongoose from "mongoose";

const ConversationSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", index: true, required: true },
    country: { type: String, default: "nigeria", index: true },
    title: { type: String, default: "New Chat" },
    lastMessageAt: { type: Date, default: Date.now, index: true },

    // Optional: summary for long chats
    summary: { type: String, default: "" },
  },
  { timestamps: true }
);

export default mongoose.model("Conversation", ConversationSchema);
