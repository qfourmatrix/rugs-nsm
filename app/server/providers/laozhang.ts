import { AppError } from "../errors";

export interface ParsedLaoZhangImage {
  data: string;
  mimeType: string;
}

interface InlineDataPart {
  inlineData?: {
    data?: string;
    mimeType?: string;
    mime_type?: string;
  };
  inline_data?: {
    data?: string;
    mimeType?: string;
    mime_type?: string;
  };
}

function findImagePart(value: unknown): InlineDataPart | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const root = value as {
    candidates?: Array<{
      content?: {
        parts?: InlineDataPart[];
      };
    }>;
  };

  const parts = root.candidates?.flatMap((candidate) => candidate.content?.parts ?? []) ?? [];
  return parts.find((part) => part.inlineData?.data || part.inline_data?.data) ?? null;
}

export async function parseLaoZhangImageResponse(responseBody: unknown): Promise<ParsedLaoZhangImage> {
  const part = findImagePart(responseBody);
  const inline = part?.inlineData ?? part?.inline_data;

  if (!inline?.data) {
    throw new AppError(502, "NO_IMAGE_DATA", "Provider returned HTTP 200 but no image data.");
  }

  return {
    data: inline.data,
    mimeType: inline.mimeType ?? inline.mime_type ?? "image/png"
  };
}

export function buildLaoZhangRequest({
  prompt,
  base64Image,
  mimeType,
  aspectRatio,
  imageSize,
  references = []
}: {
  prompt: string;
  base64Image: string;
  mimeType: string;
  aspectRatio: string;
  imageSize: string;
  references?: Array<{
    base64: string;
    mimeType: string;
  }>;
}) {
  const imageParts = [
    {
      inline_data: {
        mime_type: mimeType,
        data: base64Image
      }
    },
    ...references.map((reference) => ({
      inline_data: {
        mime_type: reference.mimeType,
        data: reference.base64
      }
    }))
  ];

  return {
    contents: [
      {
        role: "user",
        parts: [
          { text: prompt },
          ...imageParts
        ]
      }
    ],
    generationConfig: {
      responseModalities: ["IMAGE"],
      imageConfig: {
        aspectRatio,
        imageSize
      }
    }
  };
}
