interface WordSelectorProps {
  words: string[];
  onSelect: (word: string) => void;
}

export function WordSelector({ words, onSelect }: WordSelectorProps) {
  return (
    <div className="flex-1 bg-white border-2 border-gray-400 rounded-lg flex items-center justify-center">
      <div className="text-center space-y-6">
        <h2 className="text-black">Choose a word to draw</h2>
        
        <div className="flex gap-4">
          {words.map((word, idx) => (
            <button
              key={`${word}-${idx}`}
              onClick={() => onSelect(word)}
              className="px-8 py-4 bg-white border-2 border-gray-400 rounded-lg hover:bg-red-500 hover:text-white transition-all text-lg"
            >
              {word}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
