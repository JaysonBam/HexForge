import JSZip from 'jszip';
import type { Part, Material } from '../types/index';
import { extractImage } from '../utils/imageUtils';


async function getPartName(UfpGlobalFile: JSZip.JSZipObject): Promise<string> {
    try {
        const ufpData = JSON.parse(await UfpGlobalFile.async("string"));
        const objects = ufpData.metadata?.objects || [];
        if (Array.isArray(objects)) {
            const nameCounts: Record<string, number> = {};
            for (const obj of objects) {
                let name = obj.name || "Unknown Object";
                // Remove suffix like (1), (2) first, e.g., "file.stl(1)" -> "file.stl"
                name = name.replace(/\(\d+\)$/, '').trim();
                // Remove file extension if present
                name = name.replace(/\.(stl|obj|3mf)$/i, '');
                
                nameCounts[name] = (nameCounts[name] || 0) + 1;
            }

            const parts: string[] = [];
            Object.keys(nameCounts).sort().forEach(name => {
                const count = nameCounts[name];
                parts.push(count > 1 ? `${name} x${count}` : name);
            });
            
            if (parts.length > 0) {
                return parts.join(", ");
            }
        }
    } catch (e) {
        console.warn("Failed to parse UFP_Global.json for names", e);
    }
    return "Unknown Part";
}

export async function parseUltimaker(zip: JSZip, startPartNumber: number): Promise<Part[]> {
    const sliceMatadataFile = zip.file("/Cura/slicemetadata.json");
    const UfpGlobalFile = zip.file("/Metadata/UFP_Global.json");
    const thumbnailFile = zip.file("/Metadata/thumbnail.png");
    const modelFile = zip.file("/3D/model.gcode");    

    if (!sliceMatadataFile || !UfpGlobalFile) {
        console.warn("One or more required files could not be extracted");
        return [];
    }

    try {
        const PrintingInfo = JSON.parse(await sliceMatadataFile.async("string"));
        
        let printingTime = 0;
        if (modelFile) {
            // Read first 20KB as text to find header
            const content = await modelFile.async("string");
            const header = content.substring(0, 20000); // Limit search scope
            const match = header.match(/;PRINT.TIME:(\d+)/);
            if (match) {
                printingTime = parseInt(match[1], 10);
            }
        }

        const partName = await getPartName(UfpGlobalFile);

        const rawMaterials: Material[] = [0, 1].map(i => {
            let brand = PrintingInfo[`extruder_${i}`]?.all_settings?.material_brand || "Unknown";
            if (brand.toLowerCase() === "generic") brand = "";
            return {
                type: PrintingInfo[`extruder_${i}`]?.all_settings?.material_type || "Unknown",
                brand,
                weight: PrintingInfo.material?.weight?.[i] || 0,
                length: PrintingInfo.material?.length?.[i] || 0,
                cost: PrintingInfo.material?.cost?.[i] || 0,
            };
        }).filter(m => m.weight > 0);

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

        const part: Part = {
           number: startPartNumber,
           name: partName,
           printingTime: printingTime,
           materials: materials,
           imageUrl: await extractImage(thumbnailFile, `Part ${startPartNumber}`)
        }

        return [part];
    } catch (error) {
        console.error("Failed to parse file", error);
        return [];  
    }

}
