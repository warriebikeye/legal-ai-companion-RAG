import express from "express";
import multer from "multer";
import { generatePetition } from "../services/petition.service.js";

const router = express.Router();
const upload = multer({ dest: "uploads/" }); // TODO: replace with S3/Blob storage

/**
 * @swagger
 * tags:
 *   name: Violations
 *   description: Endpoints for reporting human rights violations
 */

/**
 * @swagger
 * /api/report/violations:
 *   post:
 *     summary: Report a human rights violation and generate a petition
 *     tags: [Violations]
 *     consumes:
 *       - multipart/form-data
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               description:
 *                 type: string
 *                 description: Detailed description of the violation
 *                 example: "An officer unlawfully detained a citizen without a warrant."
 *               violator_name:
 *                 type: string
 *                 description: Name of the violator (if known)
 *                 example: "Officer John Doe"
 *               violator_service_number:
 *                 type: string
 *                 description: Service number of the violator (if known)
 *                 example: "PSN12345"
 *               location:
 *                 type: string
 *                 description: Location of the violation
 *                 example: "Lagos, Nigeria"
 *               date:
 *                 type: string
 *                 format: date
 *                 description: Date of the violation
 *                 example: "2025-08-21"
 *               reporter_contact:
 *                 type: string
 *                 description: Contact information of the reporter (optional)
 *                 example: "reporter@email.com"
 *               country:
 *                 type: string
 *                 description: Country context for legal references
 *                 example: "nigeria"
 *               attachments:
 *                 type: array
 *                 description: Supporting evidence files (images/documents)
 *                 items:
 *                   type: string
 *                   format: binary
 *     responses:
 *       200:
 *         description: Petition generated successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 petition:
 *                   type: string
 *                   description: Generated petition text
 *                 sources:
 *                   type: array
 *                   description: Legal sources referenced
 *                   items:
 *                     type: string
 *       500:
 *         description: Server error while generating petition
 */
router.post(
  "/report",
  upload.array("attachments"),
  async (req, res) => {
    try {
      const {
        description,
        violator_name,
        violator_service_number,
        location,
        date,
        reporter_contact,
        country = "nigeria",
      } = req.body;

      // file uploads
      const files = req.files?.map(f => ({
        filename: f.originalname,
        path: f.path,
        mimetype: f.mimetype,
      })) || [];

      // Generate petition
      const petition = await generatePetition({
        description,
        violator_name,
        violator_service_number,
        location,
        date,
        files,
        reporter_contact,
        country,
      });

      // TODO: save to DB (petition + metadata)

      res.json({
        success: true,
        petition: petition.text,
        sources: petition.sources,
      });
    } catch (err) {
      console.error("❌ Violation report failed:", err);
      res.status(500).json({ error: err.message });
    }
  }
);

export default router;
