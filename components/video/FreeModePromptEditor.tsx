import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Box, X } from 'lucide-react';

interface Asset {
  id: string;
  url: string;
  type: 'video' | 'image';
  file: File;
  name: string;
}

interface FreeModePromptEditorProps {
  prompt: string;
  onChange: (value: string) => void;
  assets: Asset[];
}

export const FreeModePromptEditor: React.FC<FreeModePromptEditorProps> = ({
  prompt,
  onChange,
  assets
}) => {
  const editorRef = useRef<HTMLDivElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  
  const [showMentionPopover, setShowMentionPopover] = useState(false);
  const [mentionQuery, setMentionQuery] = useState('');
  const [selectedMentionIndex, setSelectedMentionIndex] = useState(0);
  const [popoverPosition, setPopoverPosition] = useState({ top: 0, left: 0 });
  const [savedRange, setSavedRange] = useState<{ node: Node; startOffset: number; endOffset: number } | null>(null);

  const filteredAssets = assets.filter(a => a.name.toLowerCase().includes(mentionQuery.toLowerCase()));

  const serializeContent = () => {
    if (!editorRef.current) return '';
    let text = '';
    const childNodes = Array.from(editorRef.current.childNodes);
    for (const node of childNodes) {
      if (node.nodeType === Node.TEXT_NODE) {
        text += node.textContent || '';
      } else if (node.nodeType === Node.ELEMENT_NODE) {
        const el = node as HTMLElement;
        if (el.classList.contains('mention-chip')) {
          text += `@asset(${el.dataset.id}:${el.dataset.name})`;
        } else if (el.nodeName === 'BR') {
          text += '\n';
        } else {
          text += el.textContent || '';
        }
      }
    }
    return text;
  };

  const handleInput = () => {
    const serialized = serializeContent();
    onChange(serialized);
    
    // Check if we need to open mention popover
    const selection = window.getSelection();
    if (!selection || !selection.focusNode) return;
    
    const node = selection.focusNode;
    const offset = selection.focusOffset;
    
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent || '';
      const textBeforeCursor = text.substring(0, offset);
      
      const lastAtIndex = textBeforeCursor.lastIndexOf('@');
      
      if (lastAtIndex !== -1) {
        const query = textBeforeCursor.substring(lastAtIndex + 1);
        if (!query.includes(' ')) { // No spaces in query allowed
          const range = selection.getRangeAt(0).cloneRange();
          range.setStart(node, lastAtIndex);
          const rect = range.getBoundingClientRect();
          const editorRect = editorRef.current?.getBoundingClientRect();
          
          if (editorRect) {
            setPopoverPosition({
              top: rect.bottom - editorRect.top + 8,
              left: rect.left - editorRect.left
            });
            setMentionQuery(query);
            setShowMentionPopover(true);
            setSelectedMentionIndex(0);
            setSavedRange({ node, startOffset: lastAtIndex, endOffset: offset });
            return;
          }
        }
      }
    }
    setShowMentionPopover(false);
  };

  const insertMention = (asset: Asset) => {
    if (!editorRef.current) return;
    
    editorRef.current.focus();
    
    let targetNode = savedRange?.node;
    let startIdx = savedRange?.startOffset;
    let endIdx = savedRange?.endOffset;
    
    // Try to get fresh selection just in case
    const selection = window.getSelection();
    if (selection && selection.rangeCount > 0) {
      const range = selection.getRangeAt(0);
      if (range.startContainer.nodeType === Node.TEXT_NODE) {
        const text = range.startContainer.textContent || '';
        const offset = range.startOffset;
        const lastAt = text.substring(0, offset).lastIndexOf('@');
        if (lastAt !== -1 && !text.substring(lastAt + 1, offset).includes(' ')) {
          targetNode = range.startContainer;
          startIdx = lastAt;
          endIdx = offset;
        }
      }
    }
    
    if (!targetNode || startIdx === undefined || endIdx === undefined) return;

    // Create chip element
    const chip = document.createElement('span');
    chip.contentEditable = 'false';
    chip.className = 'mention-chip inline-flex items-center gap-1.5 px-1.5 py-0.5 rounded-md bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-300 border border-amber-200 dark:border-amber-700/50 text-xs font-medium mx-1 align-baseline select-none cursor-default shadow-sm';
    chip.dataset.id = asset.id;
    chip.dataset.name = asset.name;
    
    const icon = document.createElement('span');
    icon.className = 'w-3.5 h-3.5 rounded-sm overflow-hidden bg-black/20 shrink-0 inline-flex items-center justify-center';
    
    if (asset.type === 'video') {
      const video = document.createElement('video');
      video.src = asset.url;
      video.className = 'w-full h-full object-cover';
      icon.appendChild(video);
    } else {
      const img = document.createElement('img');
      img.src = asset.url;
      img.className = 'w-full h-full object-cover';
      icon.appendChild(img);
    }
    
    const textNode = document.createTextNode(asset.name);
    
    chip.appendChild(icon);
    chip.appendChild(textNode);
    
    // Split the text node
    const textContent = targetNode.textContent || '';
    const beforeMention = textContent.substring(0, startIdx);
    const afterMention = textContent.substring(endIdx);

    targetNode.textContent = beforeMention;
    
    const parent = targetNode.parentNode;
    if (parent) {
      const spaceNode = document.createTextNode('\u00A0'); // nbsp to allow cursor placement
      const next = targetNode.nextSibling;
      
      if (next) {
        parent.insertBefore(chip, next);
        parent.insertBefore(spaceNode, next);
        
        if (afterMention) {
          const afterNode = document.createTextNode(afterMention);
          parent.insertBefore(afterNode, next);
        }
      } else {
        parent.appendChild(chip);
        parent.appendChild(spaceNode);
        if (afterMention) {
          parent.appendChild(document.createTextNode(afterMention));
        }
      }
      
      // Move cursor right after the space
      const newRange = document.createRange();
      newRange.setStart(spaceNode, 1);
      newRange.setEnd(spaceNode, 1);
      selection?.removeAllRanges();
      editorRef.current.focus();
      selection?.addRange(newRange);
    }
    
    setShowMentionPopover(false);
    onChange(serializeContent());
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (showMentionPopover) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedMentionIndex(prev => (prev + 1) % (filteredAssets.length || 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedMentionIndex(prev => (prev - 1 + (filteredAssets.length || 1)) % (filteredAssets.length || 1));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (filteredAssets[selectedMentionIndex]) {
          insertMention(filteredAssets[selectedMentionIndex]);
        }
      } else if (e.key === 'Escape') {
        e.preventDefault();
        setShowMentionPopover(false);
      }
    }
  };

  // Close popover on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        showMentionPopover && 
        editorRef.current && 
        !editorRef.current.contains(e.target as Node) &&
        (!popoverRef.current || !popoverRef.current.contains(e.target as Node))
      ) {
        setShowMentionPopover(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showMentionPopover]);

  return (
    <div className="relative flex-1 flex flex-col w-full h-full">
      <div
        ref={editorRef}
        contentEditable
        onInput={handleInput}
        onKeyDown={handleKeyDown}
        suppressContentEditableWarning
        className="flex-1 w-full min-h-[200px] outline-none overflow-y-auto p-4 text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 z-10"
        data-placeholder="Describe your scene in detail... Use @ to reference uploaded assets."
        style={{
           // Hack for placeholder in contenteditable
        }}
      />
      
      {/* CSS for placeholder */}
      <style>{`
        div[contenteditable]:empty:before {
          content: attr(data-placeholder);
          color: #94a3b8; /* slate-400 */
          pointer-events: none;
          display: block;
        }
        .dark div[contenteditable]:empty:before {
          color: #64748b; /* slate-500 */
        }
      `}</style>

      {/* Mention Popover - Theme Aware */}
      {showMentionPopover && (
        <div 
          ref={popoverRef}
          className="absolute z-[60] w-64 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-200 shadow-xl p-1.5 animate-in fade-in zoom-in-95"
          style={{ top: popoverPosition.top, left: Math.min(popoverPosition.left, 400) }}
        >
          <div className="px-3 py-2 text-xs font-medium text-slate-500 dark:text-slate-400 flex items-center gap-2 border-b border-slate-100 dark:border-slate-700/50 mb-1">
            <Box className="w-3.5 h-3.5" /> Add from subject library
          </div>
          {assets.length === 0 ? (
            <div className="px-3 py-4 text-xs text-center text-slate-500">
              Upload assets first
            </div>
          ) : filteredAssets.length === 0 ? (
            <div className="px-3 py-4 text-xs text-center text-slate-500">
              No matching assets
            </div>
          ) : (
            <div className="max-h-[200px] overflow-y-auto no-scrollbar">
              {filteredAssets.map((asset, index) => (
                <button
                  key={asset.id}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    insertMention(asset);
                  }}
                  className={`w-full flex items-center gap-3 px-2 py-1.5 rounded-lg text-left transition-colors ${
                    index === selectedMentionIndex 
                      ? 'bg-amber-50 dark:bg-amber-900/20 text-amber-900 dark:text-amber-100' 
                      : 'hover:bg-slate-50 dark:hover:bg-slate-700/50'
                  }`}
                >
                  <div className="w-8 h-8 rounded shrink-0 overflow-hidden bg-slate-100 dark:bg-black/50 border border-slate-200 dark:border-slate-700">
                    {asset.type === 'video' ? (
                      <video src={asset.url} className="w-full h-full object-cover" />
                    ) : (
                      <img src={asset.url} className="w-full h-full object-cover" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0 text-sm font-medium truncate">
                    {asset.name}
                  </div>
                </button>
              ))}
            </div>
          )}
          <div className="mt-1 px-3 py-1.5 text-[10px] text-slate-400 dark:text-slate-500 border-t border-slate-100 dark:border-slate-700/50">
            Type name to filter assets
          </div>
        </div>
      )}
    </div>
  );
};
