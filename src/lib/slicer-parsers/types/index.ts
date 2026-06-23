export interface Material {
  type: string;
  brand: string;
  weight: number;
  length: number; // Optional, as some materials might not have this info
  cost: number;
}

export interface Part {
  number: number;
  name: string;
  printingTime: number; // in seconds
  materials: Material[];
  imageUrl: string; 
}
