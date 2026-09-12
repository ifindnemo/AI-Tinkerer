export type Powertrain = "ice" | "hybrid" | "ev";
export type Vehicle = {
  id: string;
  brand: string;
  name: string;
  year: string | null;
  body: string;
  powertrain: Powertrain;
  description: string;
  model: { kind: "local"; url: `/models/${string}.glb` };
  hotspots?: { id: "engine" | "cooling"; label: string; position: [number, number, number] }[];
  author: string;
  license: string;
  source: string;
  thumbnail: `/models/${string}` | null;
};
export const powertrainLabels: Record<Powertrain, string> = {
  ice: "Xăng",
  hybrid: "Hybrid",
  ev: "Thuần điện",
};
// Model years are those stated by each asset creator, not model upload dates.
export const vehicles: Vehicle[] = [
  {
    id: "bmw-m2",
    brand: "BMW",
    name: "M2 Coupé",
    year: "2023",
    body: "Coupé",
    powertrain: "ice",
    description: "G87 · model local",
    model: {
      kind: "local",
      url: "/models/bmw-m2.glb",
    },
    hotspots: [
      { id: "engine", label: "Động cơ", position: [0, 0.95, 1.05] },
      { id: "cooling", label: "Làm mát", position: [0, 0.5, 2.1] },
    ],
    author: "Outlaw Games™",
    license: "CC BY-NC 4.0",
    source:
      "https://sketchfab.com/3d-models/2023-bmw-m2-coupe-4bb3ebbb88b04ab6bbb1b95f2aa1c176",
    thumbnail: "/models/bmw-m2-thumbnail.png",
  },
];
export const getVehicle = (id: string): Vehicle => {
  const vehicle = vehicles.find((vehicle) => vehicle.id === id);
  if (!vehicle) throw new Error(`Unknown vehicle: ${id}`);
  return vehicle;
};
