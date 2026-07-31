import JSZip from 'jszip';
import type { Part, Material } from '../types/index';
import { extractImage } from '../utils/imageUtils';

interface BBoxObject {
    name: string;
}

async function generatePartName(zip: JSZip, plateIndex: number, defaultName: string): Promise<string> {
    const jsonFilename = `Metadata/plate_${plateIndex}.json`;
    const jsonFile = zip.file(jsonFilename);

    if (!jsonFile) {
        console.warn(`${jsonFilename} not found, using default name.`);
        return defaultName;
    }

    try {
        const content = await jsonFile.async("string");
        const data = JSON.parse(content); 
        const bboxObjects = data.bbox_objects as BBoxObject[];

        if (!bboxObjects || !Array.isArray(bboxObjects)) {
            return defaultName;
        }

        const nameCounts: Record<string, number> = {};

        for (const obj of bboxObjects) {
             const rawName = obj.name || "Unknown Object";
             if (rawName === "wipe_tower") continue;

             nameCounts[rawName] = (nameCounts[rawName] || 0) + 1;
        }

        const parts: string[] = [];
        const sortedNames = Object.keys(nameCounts).sort();

        for (const name of sortedNames) {
            const count = nameCounts[name];
            if (count > 1) {
                parts.push(`${name} x${count}`);
            } else {
                parts.push(name);
            }
        }

        if (parts.length === 0) return defaultName;

        return parts.join(", ");

    } catch (error) {
        console.error(`Failed to parse ${jsonFilename}:`, error);
        return defaultName;
    }
}

export async function parseBambu(zip: JSZip, startPartNumber: number, filename: string): Promise<Part[]> {
    const configFile = zip.file("Metadata/project_settings.config");
    const sliceInfoFile = zip.file("Metadata/slice_info.config");
    if (!configFile || !sliceInfoFile) {
        console.warn("Metadata/project_settings.config or slice_info.config not found.");
        return [];
    }

    // One file can contain multiple plates(parts), each plate(part) can contain multiple materials
    try {
        const projectSettings = JSON.parse(await configFile.async("string"));
        const filament_costs: number[] = projectSettings?.filament_cost || []; 
        const filament_types: string[] = projectSettings?.filament_type || [];
        const filament_vendors: string[] = projectSettings?.filament_vendor || [];

        const sliceInfoXml = new DOMParser().parseFromString(await sliceInfoFile.async("string"), "text/xml");
        const plates = sliceInfoXml.querySelectorAll("plate");
        const parts: Part[] = [];
        for (let i = 0; i < plates.length; i++) {
            const plate = plates[i];

            const number = startPartNumber + i;
            let name = filename;
            if (plates.length > 1) {
                name = `${filename}_${i + 1}`; 
            }
            // Generate Name from Plate JSON (e.g. "Torus x6, wipe_tower")
            name = await generatePartName(zip, i + 1, name);

            const predictionEl = plate.querySelector('metadata[key="prediction"]');
            const printingTime = predictionEl ? parseFloat(predictionEl.getAttribute("value") || "0") : 0;

            const rawMaterials: Material[] = [];
            const filamentEntries = plate.querySelectorAll("filament");
            for (let fi = 0; fi < filamentEntries.length; fi++) {
                const filament = filamentEntries[fi];

                const candidateAttrs = ['filament_id','filamentIndex','filament_index','filament-id','id','index','extruder','slot','tool'];
                let idAttr: string | null = null;
                for (const a of candidateAttrs) {
                    const v = filament.getAttribute(a);
                    if (v != null) { idAttr = v; break; }
                }
                if (idAttr == null) idAttr = String(fi + 1);

                let filamentIndex = parseInt(idAttr.toString().trim(), 10);
                if (isNaN(filamentIndex)) filamentIndex = fi + 1;
                let filamentID = filamentIndex - 1;

                let clamped = false;
                if (filamentID < 0) { filamentID = 0; clamped = true; }
                if (filament_types.length > 0 && filamentID >= filament_types.length) {
                    filamentID = Math.min(filamentID, filament_types.length - 1);
                    clamped = true;
                }

                if (idAttr === String(fi + 1) || clamped) {
                    console.warn(`BambuParser: resolved filament id attr='${idAttr}' -> index=${filamentID} (fallback/clamped)
`);
                }

                const type = filament_types[filamentID] || "Unknown";
                let brand = filament_vendors[filamentID] || "Unknown";
                if (brand.toLowerCase() === "generic") brand = "";
                const weight = parseFloat(filament.getAttribute("used_g") || "0");
                const length = parseFloat(filament.getAttribute("used_m") || "0");
                const cost = filament_costs[filamentID] ? (filament_costs[filamentID] / 1000 * weight) : 0;
                rawMaterials.push({ type, brand, weight, length, cost });
            }

            // Combine materials of the same type
            const combined: Record<string, Material> = {};
            for (const m of rawMaterials) {
                if (!combined[m.type]) {
                    combined[m.type] = { ...m };
                } else {
                    combined[m.type].weight += m.weight;
                    combined[m.type].length += m.length;
                    combined[m.type].cost += m.cost;
                }
            }
            
            // Sort by weight descending and take at most top 2
            const materials = Object.values(combined)
                .sort((a, b) => b.weight - a.weight)
                .slice(0, 2);         

            const imageFile = zip.file(`Metadata/plate_${i+1}.png`);
            
            const imageUrl = await extractImage(imageFile, `Part ${i+1}`);

            parts.push({
                number,
                name,
                printingTime,
                materials,
                imageUrl
            });
        }        
        return parts;
    } catch (error) {
        console.error("Failed to parse file", error);
        return [];  
    }
}