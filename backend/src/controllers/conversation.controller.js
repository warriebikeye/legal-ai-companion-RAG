import Conversation from "../models/Conversation.js";
import Message from "../models/Message.js";

export async function listConversations(req, res) {
  const userId = req.user?._id;
  if (!userId) return res.status(401).json({ error: "Unauthorized" });

  const convos = await Conversation.find({ userId })
    .sort({ lastMessageAt: -1 })
    .limit(30)
    .lean();

  return res.json({ success: true, conversations: convos });
}

export async function getConversationMessages(req, res) {
  const userId = req.user?._id;
  if (!userId) return res.status(401).json({ error: "Unauthorized" });

  const { conversationId } = req.params;

  const msgs = await Message.find({ conversationId, userId })
    .sort({ createdAt: 1 })
    .lean();

  return res.json({ success: true, messages: msgs });
}
