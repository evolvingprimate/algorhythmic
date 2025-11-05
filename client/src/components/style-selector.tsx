import { useState } from "react";
import { X, Check, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import cubistImage from "@assets/generated_images/Cubist_geometric_composition_aa773ee7.png";
import pointillistImage from "@assets/generated_images/Pointillist_dotted_landscape_16a33696.png";
import fluidImage from "@assets/generated_images/Digital_fluid_paint_swirls_8aeeb143.png";
import vanGoghImage from "@assets/generated_images/Van_Gogh_swirling_starry_art_90bb8bcc.png";
import daliImage from "@assets/generated_images/Dali_surrealist_dreamscape_80c595de.png";
import colorFieldImage from "@assets/generated_images/Color_field_abstract_blocks_6a364188.png";
import wireframeImage from "@assets/generated_images/Neon_wireframe_digital_art_0459c9fd.png";

interface StyleOption {
  id: string;
  name: string;
  image: string;
  description: string;
}

const styles: StyleOption[] = [
  {
    id: "surrealism",
    name: "Surrealism",
    image: daliImage,
    description: "Dreamlike, impossible scenes",
  },
  {
    id: "impressionism",
    name: "Impressionism",
    image: pointillistImage,
    description: "Soft, dotted patterns",
  },
  {
    id: "cubism",
    name: "Cubism",
    image: cubistImage,
    description: "Geometric fragments",
  },
  {
    id: "abstract",
    name: "Abstract",
    image: fluidImage,
    description: "Fluid forms and colors",
  },
  {
    id: "vangogh",
    name: "Van Gogh Style",
    image: vanGoghImage,
    description: "Swirling brushstrokes",
  },
  {
    id: "colorfield",
    name: "Color Field",
    image: colorFieldImage,
    description: "Bold color blocks",
  },
  {
    id: "digital",
    name: "Digital/Cyber",
    image: wireframeImage,
    description: "Neon and wireframes",
  },
  {
    id: "italian-brain-rot",
    name: "Italian Brain Rot",
    image: fluidImage,
    description: "Chaotic viral vibes",
  },
  {
    id: "cartoon",
    name: "Cartoon",
    image: colorFieldImage,
    description: "Bold, animated style",
  },
  {
    id: "realism",
    name: "Realism",
    image: vanGoghImage,
    description: "Lifelike and detailed",
  },
  {
    id: "horror",
    name: "Horror",
    image: daliImage,
    description: "Dark and eerie",
  },
  {
    id: "kids",
    name: "Kids",
    image: pointillistImage,
    description: "Playful and colorful",
  },
  {
    id: "trippy",
    name: "Trippy",
    image: cubistImage,
    description: "Psychedelic patterns",
  },
];

const artists = [
  "Salvador Dalí",
  "Pablo Picasso",
  "Vincent van Gogh",
  "Claude Monet",
  "Wassily Kandinsky",
  "Jackson Pollock",
  "Mark Rothko",
  "Piet Mondrian",
  "René Magritte",
  "Georgia O'Keeffe",
];

interface StyleSelectorProps {
  selectedStyles: string[];
  dynamicMode?: boolean;
  onStylesChange: (styles: string[], dynamicMode: boolean) => void;
  onClose: () => void;
}

export function StyleSelector({ selectedStyles, dynamicMode = false, onStylesChange, onClose }: StyleSelectorProps) {
  const [localSelection, setLocalSelection] = useState<string[]>(selectedStyles);
  const [localDynamicMode, setLocalDynamicMode] = useState<boolean>(dynamicMode);
  const [activeTab, setActiveTab] = useState<"styles" | "artists">("styles");

  const toggleSelection = (id: string) => {
    setLocalSelection(prev => 
      prev.includes(id) 
        ? prev.filter(s => s !== id)
        : [...prev, id]
    );
  };

  const handleSave = () => {
    onStylesChange(localSelection, localDynamicMode);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm p-4">
      <Card className="w-full max-w-4xl h-[90vh] flex flex-col">
        <div className="flex items-center justify-between p-6 border-b">
          <div>
            <h2 className="text-2xl font-bold">Choose Your Artistic Style</h2>
            <p className="text-sm text-muted-foreground mt-1">
              {localDynamicMode 
                ? "AI will automatically choose styles based on music genre and album artwork"
                : "Select styles and artists that inspire you"}
            </p>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose} data-testid="button-close-style-selector">
            <X className="h-5 w-5" />
          </Button>
        </div>

        <div className="px-6 pt-4 pb-3 border-b bg-muted/30">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Sparkles className="h-5 w-5 text-primary" />
              <div>
                <Label htmlFor="dynamic-mode" className="font-semibold cursor-pointer">
                  Dynamic Art Style
                </Label>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Let AI choose the perfect style for each song
                </p>
              </div>
            </div>
            <Switch
              id="dynamic-mode"
              checked={localDynamicMode}
              onCheckedChange={setLocalDynamicMode}
              data-testid="switch-dynamic-mode"
            />
          </div>
        </div>

        {!localDynamicMode && (
          <div className="flex gap-2 px-6 pt-4 border-b">
          <Button
            variant={activeTab === "styles" ? "default" : "outline"}
            onClick={() => setActiveTab("styles")}
            data-testid="button-tab-styles"
          >
            Art Styles
          </Button>
          <Button
            variant={activeTab === "artists" ? "default" : "outline"}
            onClick={() => setActiveTab("artists")}
            data-testid="button-tab-artists"
          >
            Artists
          </Button>
        </div>
        )}

        {!localDynamicMode && (
          <div className="flex-1 overflow-hidden">
            <ScrollArea className="h-full px-6 py-6">
              {activeTab === "styles" ? (
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 pb-2">
              {styles.map((style) => {
                const isSelected = localSelection.includes(style.id);
                return (
                  <button
                    key={style.id}
                    onClick={() => toggleSelection(style.id)}
                    className="relative group"
                    data-testid={`style-option-${style.id}`}
                  >
                    <div className={`relative aspect-[3/4] rounded-md overflow-hidden border-2 transition-all ${
                      isSelected ? "border-primary scale-95" : "border-transparent hover-elevate"
                    }`}>
                      <img 
                        src={style.image} 
                        alt={style.name}
                        className="w-full h-full object-cover"
                      />
                      {isSelected && (
                        <div className="absolute inset-0 bg-primary/20 flex items-center justify-center">
                          <div className="bg-primary text-primary-foreground rounded-full p-2">
                            <Check className="h-6 w-6" />
                          </div>
                        </div>
                      )}
                    </div>
                    <div className="mt-2">
                      <p className="font-medium text-sm">{style.name}</p>
                      <p className="text-xs text-muted-foreground">{style.description}</p>
                    </div>
                  </button>
                );
              })}
                </div>
              ) : (
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3 pb-2">
              {artists.map((artist) => {
                const isSelected = localSelection.includes(artist);
                return (
                  <button
                    key={artist}
                    onClick={() => toggleSelection(artist)}
                    className={`p-4 rounded-md border-2 transition-all text-left ${
                      isSelected 
                        ? "border-primary bg-primary/5" 
                        : "border-border hover-elevate"
                    }`}
                    data-testid={`artist-option-${artist.replace(/\s+/g, '-')}`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-medium">{artist}</span>
                      {isSelected && (
                        <Check className="h-5 w-5 text-primary flex-shrink-0" />
                      )}
                    </div>
                  </button>
                );
              })}
                </div>
              )}
            </ScrollArea>
          </div>
        )}

        {localDynamicMode && (
          <div className="flex-1 flex items-center justify-center p-12">
            <div className="text-center max-w-md space-y-4">
              <Sparkles className="h-16 w-16 text-primary mx-auto" />
              <h3 className="text-xl font-semibold">AI-Powered Dynamic Styling</h3>
              <p className="text-muted-foreground">
                When dynamic mode is enabled, our AI will automatically select the perfect artistic style 
                for each song based on its genre, mood, and album artwork. Each track gets a unique visual 
                interpretation tailored to its essence.
              </p>
              <div className="grid grid-cols-2 gap-3 pt-4 text-sm">
                <div className="p-3 rounded-md bg-muted">
                  <p className="font-medium">Hip-Hop</p>
                  <p className="text-xs text-muted-foreground">Urban street art</p>
                </div>
                <div className="p-3 rounded-md bg-muted">
                  <p className="font-medium">Classical</p>
                  <p className="text-xs text-muted-foreground">Elegant impressionism</p>
                </div>
                <div className="p-3 rounded-md bg-muted">
                  <p className="font-medium">Rock</p>
                  <p className="text-xs text-muted-foreground">Bold abstract</p>
                </div>
                <div className="p-3 rounded-md bg-muted">
                  <p className="font-medium">Pop</p>
                  <p className="text-xs text-muted-foreground">Vibrant colorful</p>
                </div>
              </div>
            </div>
          </div>
        )}

        <div className="p-6 border-t flex items-center justify-between">
          <div>
            <Badge variant="outline">
              {localSelection.length} selected
            </Badge>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose} data-testid="button-cancel-selection">
              Cancel
            </Button>
            <Button 
              onClick={handleSave} 
              disabled={!localDynamicMode && localSelection.length === 0}
              data-testid="button-save-selection"
            >
              {localDynamicMode ? "Enable Dynamic Mode" : "Create My Station"}
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
}
