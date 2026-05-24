import { create } from 'zustand';

export const useStore = create((set) => ({
  modelUrl: null,
  setModelUrl: (url) => set({ modelUrl: url }),
  
  footprint: [], // array of [x, y]
  offsets: [],   // array of numbers
  safeZone: [],  // array of [x, y]
  
  isLoading: false,
  isMeshMode: false,
  exportModel: null,
  
  setIsLoading: (loading) => set({ isLoading: loading }),
  
  setSimulationData: (data) => set({
    footprint: data.footprint,
    offsets: data.offsets,
    safeZone: data.safeZone,
    isMeshMode: false
  }),
  
  updateSafeZone: (newZone) => set({ safeZone: newZone }),
  
  updateOffset: (indices, value) => set((state) => {
    const newOffsets = [...state.offsets];
    indices.forEach(i => {
      newOffsets[i] = value;
    });
    return { offsets: newOffsets };
  }),
  
  toggleMeshMode: () => set(state => ({ isMeshMode: !state.isMeshMode })),
  
  setExportModel: (fn) => set({ exportModel: fn }),
  
  selectedEdges: [],
  setSelectedEdges: (indices) => set({ selectedEdges: indices }),
  toggleEdgeSelection: (index, multi) => set((state) => {
    if (multi) {
      return { 
        selectedEdges: state.selectedEdges.includes(index) 
          ? state.selectedEdges.filter(i => i !== index) 
          : [...state.selectedEdges, index] 
      };
    }
    return { selectedEdges: [index] };
  }),
}));
