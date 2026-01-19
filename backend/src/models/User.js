import mongoose from "mongoose";

const UserSchema = new mongoose.Schema(
  {
    googleId: { type: String, required: true, unique: true, index: true },
    email: { type: String, required: true, index: true },
    name: { type: String, default: "" },
    photo: { type: String, default: "" },
  },
  { timestamps: true }
);

export default mongoose.model("User", UserSchema);
