// petition.service.js
import * as geminiLLM from '../llm/gemini.js';
import { qdrant } from "../vectorstore/qdrant.js";

/**
 * Decide which authorities the petition should be sent to
 */
function resolveAuthority({ violator_service_number, country }) {
    const authorities = [];

    if (country?.toLowerCase() === "nigeria") {
        authorities.push({
            name: "National Human Rights Commission (NHRC)",
            address: "19 Aguiyi Ironsi Street, Maitama, Abuja, Nigeria",
        });

        if (violator_service_number) {
            authorities.push({
                name: "Police Service Commission",
                address: "PSC Headquarters, Federal Secretariat Complex, Abuja, Nigeria",
            });
            authorities.push({
                name: "Inspector General of Police",
                address: "Force Headquarters, Louis Edet House, Abuja, Nigeria",
            });
            authorities.push({
                name: "National Human Rights Institution",
                address: "[Insert Address]",
            });
        }
    }

    // Fallback default
    if (authorities.length === 0) {
        authorities.push({
            name: "National Human Rights Institution",
            address: "[Insert Address]",
        });
    }

    return authorities;
}

/**
 * Generate a human rights violation petition
 */
export async function generatePetition({
    description,
    violator_name,
    violator_service_number,
    location,
    date,
    files,
    reporter_name,
    reporter_contact,
    country,
}) {
    // 1. Embed description
    const vector = await geminiLLM.getEmbedding(description);
    const collection = `legal_chunks_${country.toLowerCase()}-gm`;

    // 2. Get legal context
    const results = await qdrant.search(collection, {
        vector,
        top: 5,
        with_payload: true,
    });

    const context = results.map(r => r.payload.text).join("\n\n");
    const sources = [
        ...new Set(results.map(r => r.payload.source).filter(Boolean)),
    ];

    // 3. Resolve authorities
    const authorities = resolveAuthority({ violator_service_number, country });

    // 4. Build structured petition template
    const systemPrompt = `
You are a legal assistant generating a **formal petition**.
Use this exact structure:

To: ${authorities.map(a => a.name).join(" / ")}
${authorities.map(a => a.address).join(" / ")}

Date: ${date || "Today’s Date"}

Subject: Petition Regarding Violation of Human Rights

---

Dear Sir/Madam,

I, ${reporter_name || "the undersigned"}, wish to bring to your attention a violation of human rights that occurred on ${date || "the stated date"} at ${location || "the specified location"}.

Details of Violation:
${description}
${files && files.length > 0 ? "Attached evidence has been provided." : "No attachments provided."}

Violator Information:
- Name: ${violator_name || "Not provided"}
- Service Number: ${violator_service_number || "Not provided"}

Legal Basis:
According to the laws of ${country}, specifically:
${context}

This action constitutes a breach of the above provisions, thereby infringing upon the fundamental rights guaranteed under national and international law.

Prayer:
In light of the above, I respectfully request that your office take the necessary disciplinary and legal action against the violator(s), and ensure the protection of human rights.

Yours faithfully,

${reporter_name || "Anonymous"}
${reporter_contact || ""}

(Signature or Digital Signature if applicable)

---

Attachments (if any):
${files && files.length > 0 ? files.map(f => `- ${f}`).join("\n") : "None"}
`;

    // 5. Generate petition text
    const answer = await geminiLLM.getAnswer(description, context, systemPrompt);

    return { text: answer, sources, authorities };
}
