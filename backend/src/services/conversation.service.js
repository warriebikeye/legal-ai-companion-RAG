import Conversation from "../models/Conversation.js";
import Message from "../models/Message.js";

export async function getOrCreateConversation({ conversationId, userId, country }) {
  if (conversationId) {
    const convo = await Conversation.findOne({ _id: conversationId, userId });
    if (convo) return convo;
  }

  return Conversation.create({
    userId,
    country: (country || "nigeria").toLowerCase(),
    title: "New Chat",
  });
}

export async function appendMessage({
  conversationId,
  userId,
  role,
  content,
  sources = [],
  clauseAnalysis = null,
  documentText = "",
}) {
  const msg = await Message.create({
    conversationId,
    userId,
    role,
    content,
    sources,
    clauseAnalysis,
    documentText,
  });

  await Conversation.updateOne(
    { _id: conversationId, userId },
    { $set: { lastMessageAt: new Date() } }
  );

  return msg;
}

export async function loadRecentMessages({ conversationId, userId, limit = 12 }) {
  const msgs = await Message.find({ conversationId, userId })
    .sort({ createdAt: -1 })
    .limit(limit)
    .lean();

  return msgs.reverse();
}
