import JSZip from 'jszip';
import type { Part } from '../types';
import { parseBambu } from '../lib/slicer-parsers/parsers/BambuParser';
import { parseUltimaker } from '../lib/slicer-parsers/parsers/UltimakerParser';

type ParsedMaterial = {
  type?: string;
  brand?: string;
  weight?: number;
  cost?: number;
  length?: number;
};

type ParsedSlicerPart = {
  name?: string;
  printingTime: number;
  imageUrl?: string;
  materials?: ParsedMaterial[];
};

export const isImportEligibleFilename = (filename: string): boolean => {
  const lower = filename.toLocaleLowerCase();
  return lower.endsWith('.gcode.3mf') || lower.endsWith('.3mf') || lower.endsWith('.ufp');
};

export const analyzeProjectFiles = async (args: {
  files: File[];
  startPartNumber: number;
  getFilamentPrice: (material: string) => number;
  uploadThumbnail: (blobUrl: string) => Promise<string | null>;
}): Promise<{ parts: Partial<Part>[]; errors: string[] }> => {
  const parts: Partial<Part>[] = [];
  const errors: string[] = [];
  let partCounter = args.startPartNumber;

  for (const uploadedFile of args.files) {
    const lowerName = uploadedFile.name.toLocaleLowerCase();
    const isBambu = lowerName.endsWith('.gcode.3mf');
    const isUltimaker = lowerName.endsWith('.ufp');
    const isStandard3mf = lowerName.endsWith('.3mf') && !isBambu;
    if (!isBambu && !isUltimaker && !isStandard3mf) {
      errors.push(`File ${uploadedFile.name} is not a supported import format (.3mf, .gcode.3mf, .ufp).`);
      continue;
    }

    try {
      const zipContent = await new JSZip().loadAsync(uploadedFile);
      let parsedParts: ParsedSlicerPart[] = [];
      if (isBambu || isStandard3mf) {
        const bareFilename = uploadedFile.name.replace(/(\.gcode\.3mf|\.3mf)$/i, '');
        parsedParts = await parseBambu(zipContent, partCounter, bareFilename) as ParsedSlicerPart[];
      } else {
        parsedParts = await parseUltimaker(zipContent, partCounter) as ParsedSlicerPart[];
      }
      if (!parsedParts.length) {
        errors.push(`File ${uploadedFile.name} was parsed but no printable parts were found.`);
        continue;
      }
      for (const parsedPart of parsedParts) {
        partCounter += 1;
        const materials = parsedPart.materials ?? [];
        const primary = materials[0];
        const secondary = materials[1];
        const primaryWeight = primary?.weight ?? 0;
        const secondaryWeight = secondary?.weight ?? 0;
        const primaryPrice = primary?.type ? args.getFilamentPrice(primary.type) : 0;
        const secondaryPrice = secondary?.type ? args.getFilamentPrice(secondary.type) : 0;
        const hours = Math.floor(parsedPart.printingTime / 3600);
        const minutes = Math.floor((parsedPart.printingTime % 3600) / 60);
        const imageUrl = parsedPart.imageUrl ? await args.uploadThumbnail(parsedPart.imageUrl) || parsedPart.imageUrl : undefined;

        parts.push({
          partName: parsedPart.name || uploadedFile.name,
          primaryMaterialCost: Number((primary?.cost ?? 0).toFixed(2)),
          primaryServiceCost: Number((Math.round(primaryWeight) * primaryPrice).toFixed(2)),
          primaryEstimatedWeight: Math.round(primaryWeight),
          primaryWeight: Number(primaryWeight.toFixed(2)),
          printingTime: `${hours}h ${minutes}m`,
          primaryLength: Number((primary?.length ?? 0).toFixed(2)),
          secondaryLength: Number((secondary?.length ?? 0).toFixed(2)),
          primaryMaterial: primary?.type || '',
          primaryBrand: primary?.brand || '',
          secondaryMaterial: secondary?.type || undefined,
          secondaryBrand: secondary?.brand || undefined,
          imageUrl,
          materials: parsedPart.materials,
          secondaryEstimatedWeight: Math.round(secondaryWeight),
          secondaryWeight: Number(secondaryWeight.toFixed(2)),
          secondaryServiceCost: Number((Math.round(secondaryWeight) * secondaryPrice).toFixed(2)),
          secondaryMaterialCost: Number((secondary?.cost ?? 0).toFixed(2)),
          printStatus: 'DRAFT'
        });
      }
    } catch {
      errors.push(`Failed to analyze ${uploadedFile.name}. It might be corrupted or unsupported.`);
    }
  }

  return { parts, errors };
};
