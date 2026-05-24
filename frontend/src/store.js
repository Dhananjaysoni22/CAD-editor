import { create } from 'zustand';

export const useStore = create((set) => ({
  modelUrl: null,
  setModelUrl: (url) => set({ modelUrl: url }),
  
  footprint: [], // array of [x, y]
  offsets: [],   // array of numbers
  safeZone: [],  // array of [x, y]
  
  isLoading: false,
  setIsLoading: (loading) => set({ isLoading: loading }),
  
  setSimulationData: (data) => set({
    footprint: data.footprint,
    offsets: data.offsets,
    safeZone: data.safeZone
  }),
  
  updateSafeZone: (safeZone) => set({ safeZone }),
  
  updateOffset: (indices, newOffset) => set((state) => {
    const newOffsets = [...state.offsets];
    indices.forEach(index => {
      newOffsets[index] = newOffset;
    });
    return { offsets: newOffsets };
  }),
  
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
