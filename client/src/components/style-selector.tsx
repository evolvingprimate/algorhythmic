import { useState } from "react";
import { X, Check, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
// Classic Masters
import surrealismImage from "@assets/generated_images/Surrealism_style_thumbnail_cb5f2897.png";
import impressionismImage from "@assets/generated_images/Impressionism_style_thumbnail_726cee9a.png";
import cubismImage from "@assets/generated_images/Cubism_style_thumbnail_19a87b24.png";
import vanGoghImage from "@assets/generated_images/Van_Gogh_style_thumbnail_67d77d29.png";
import colorFieldImage from "@assets/generated_images/Color_field_style_thumbnail_b170ae78.png";
import renaissanceImage from "@assets/generated_images/Renaissance_style_thumbnail_d021b69e.png";
import baroqueImage from "@assets/generated_images/Baroque_style_thumbnail_adc23f2e.png";
import pointillismImage from "@assets/generated_images/Pointillism_style_thumbnail_8bc094a1.png";
// Modern Digital
import abstractImage from "@assets/generated_images/Abstract_style_thumbnail_146a060e.png";
import digitalImage from "@assets/generated_images/Digital_cyber_style_thumbnail_40cb0953.png";
import pixelArtImage from "@assets/generated_images/8-bit_pixel_art_thumbnail_8837b636.png";
import animeImage from "@assets/generated_images/Anime_style_thumbnail_b4434587.png";
import claymationImage from "@assets/generated_images/Claymation_style_thumbnail_d1d43e39.png";
import vectorImage from "@assets/generated_images/Vector_art_style_thumbnail_3be3bbc7.png";
import lowPolyImage from "@assets/generated_images/Low-Poly_style_thumbnail_e12ee306.png";
import glitchImage from "@assets/generated_images/Glitch_art_style_thumbnail_d3cadc2c.png";
// Dream & Mind
import psychedelicImage from "@assets/generated_images/Trippy_style_thumbnail_5bdb5cf9.png";
import italianBrainRotImage from "@assets/generated_images/Italian_brain_rot_thumbnail_bc833352.png";
import cartoonImage from "@assets/generated_images/Cartoon_style_thumbnail_52e4f26d.png";
import expressionismImage from "@assets/generated_images/Expressionism_style_thumbnail_62cfa27c.png";
import opArtImage from "@assets/generated_images/Op_Art_style_thumbnail_de1a8618.png";
import fantasyImage from "@assets/generated_images/Fantasy_style_thumbnail_3c7b3d39.png";
import opticalIllusionImage from "@assets/generated_images/Optical_illusions_thumbnail_8cce40bc.png";
import minimalistImage from "@assets/generated_images/Minimalist_style_thumbnail_08f8a6f7.png";
// Realism & Nature
import realismImage from "@assets/generated_images/Realism_style_thumbnail_751ddd8b.png";
import photorealismImage from "@assets/generated_images/Photorealism_style_thumbnail_3b79c7d1.png";
import landscapeImage from "@assets/generated_images/Landscape_style_thumbnail_6e8db221.png";
import portraitImage from "@assets/generated_images/Portrait_style_thumbnail_fae231c3.png";
import wildlifeImage from "@assets/generated_images/Wildlife_style_thumbnail_68fa073d.png";
import stillLifeImage from "@assets/generated_images/Still_Life_style_thumbnail_f477c806.png";
import hyperrealismImage from "@assets/generated_images/Hyperrealism_style_thumbnail_a45aec75.png";
import botanicalImage from "@assets/generated_images/Botanical_style_thumbnail_a5700015.png";
// Dark & Moody
import horrorImage from "@assets/generated_images/Horror_style_thumbnail_a8839b25.png";
import gothicImage from "@assets/generated_images/Gothic_style_thumbnail_b34a2fab.png";
import noirImage from "@assets/generated_images/Noir_style_thumbnail_0bd975c4.png";
import darkFantasyImage from "@assets/generated_images/Dark_Fantasy_style_thumbnail_c5a0e173.png";
import vaporwaveImage from "@assets/generated_images/Dark_Vaporwave_thumbnail_33416e23.png";
import steampunkImage from "@assets/generated_images/Steampunk_Shadows_thumbnail_b691c1c9.png";
import dystopianImage from "@assets/generated_images/Dystopian_style_thumbnail_5fb8ca65.png";
import macabreImage from "@assets/generated_images/Macabre_style_thumbnail_6e7a2610.png";
// Sci-Fi & Future
import sciFiImage from "@assets/generated_images/Sci-Fi_style_thumbnail_5843dbcc.png";
import cyberpunkImage from "@assets/generated_images/Cyberpunk_style_thumbnail_49261c04.png";
import retroFuturismImage from "@assets/generated_images/Retro-Futurism_thumbnail_da542b24.png";
import spaceOperaImage from "@assets/generated_images/Space_Opera_style_thumbnail_cd298d8e.png";
import neonNoirImage from "@assets/generated_images/Neon_Noir_style_thumbnail_bebcd60b.png";
import biotechImage from "@assets/generated_images/Biotech_style_thumbnail_9c7504bc.png";
import holographicImage from "@assets/generated_images/Holographic_style_thumbnail_adde86f4.png";
import apocalypticImage from "@assets/generated_images/Apocalyptic_style_thumbnail_2f2c2c37.png";
// Seasonal & Holidays
import halloweenImage from "@assets/generated_images/Halloween_style_thumbnail_8c4890e8.png";
import christmasImage from "@assets/generated_images/Christmas_style_thumbnail_77ab8639.png";
import newYearImage from "@assets/generated_images/New_Year's_Day_thumbnail_787f68d4.png";
import mlkImage from "@assets/generated_images/MLK_Jr_Day_thumbnail_9ce36eff.png";
import presidentsImage from "@assets/generated_images/Presidents_Day_thumbnail_67e06cd4.png";
import memorialImage from "@assets/generated_images/Memorial_Day_thumbnail_4ca638f7.png";
import juneteenthImage from "@assets/generated_images/Juneteenth_thumbnail_8777235a.png";
import july4Image from "@assets/generated_images/July_4th_thumbnail_17ba9919.png";
import laborDayImage from "@assets/generated_images/Labor_Day_thumbnail_0bb0ca69.png";
import indigenousImage from "@assets/generated_images/Indigenous_Day_thumbnail_5481f584.png";
import veteransImage from "@assets/generated_images/Veterans_Day_thumbnail_bf864269.png";
import thanksgivingImage from "@assets/generated_images/Thanksgiving_thumbnail_a98bd0af.png";
import ramadanImage from "@assets/generated_images/Ramadan_thumbnail_73c661b3.png";
import eidFitrImage from "@assets/generated_images/Eid_al-Fitr_thumbnail_6f309973.png";
import eidAdhaImage from "@assets/generated_images/Eid_al-Adha_thumbnail_72ee0a63.png";
import diwaliImage from "@assets/generated_images/Diwali_thumbnail_9ef4b323.png";
import lunarNewYearImage from "@assets/generated_images/Lunar_New_Year_thumbnail_de4584f5.png";
import vesakImage from "@assets/generated_images/Vesak_thumbnail_4991ed5b.png";
import holiImage from "@assets/generated_images/Holi_thumbnail_9ac41049.png";
import easterImage from "@assets/generated_images/Easter_thumbnail_e8d025d2.png";
// Meme Culture
import nyanCatImage from "@assets/generated_images/Nyan_Cat_meme_thumbnail_7d05dcab.png";
import distractedBfImage from "@assets/generated_images/Distracted_Boyfriend_meme_964e1421.png";
import thisIsFineImage from "@assets/generated_images/This_Is_Fine_meme_4c25c73f.png";
import expandingBrainImage from "@assets/generated_images/Expanding_Brain_meme_bcd1ca4f.png";
import dogeImage from "@assets/generated_images/Doge_meme_thumbnail_9c5af1ed.png";
import pepeImage from "@assets/generated_images/Pepe_meme_thumbnail_41846324.png";
import wojakImage from "@assets/generated_images/Wojak_meme_thumbnail_38f21d43.png";
import rickrollImage from "@assets/generated_images/Rickroll_meme_thumbnail_f0ab5e76.png";

interface StyleOption {
  id: string;
  name: string;
  image: string;
  description: string;
}

interface StyleGroup {
  name: string;
  styles: StyleOption[];
}

const styleGroups: StyleGroup[] = [
  {
    name: "CLASSIC MASTERS",
    styles: [
      { id: "surrealism", name: "Surrealism", image: surrealismImage, description: "Dreamlike, impossible scenes" },
      { id: "impressionism", name: "Impressionism", image: impressionismImage, description: "Soft, dotted patterns" },
      { id: "cubism", name: "Cubism", image: cubismImage, description: "Geometric fragments" },
      { id: "vangogh", name: "Van Gogh Style", image: vanGoghImage, description: "Swirling brushstrokes" },
      { id: "colorfield", name: "Color Field", image: colorFieldImage, description: "Bold color blocks" },
      { id: "renaissance", name: "Renaissance", image: renaissanceImage, description: "Classical masterpieces" },
      { id: "baroque", name: "Baroque", image: baroqueImage, description: "Dramatic grandeur" },
      { id: "pointillism", name: "Pointillism", image: pointillismImage, description: "Dotted technique" },
    ]
  },
  {
    name: "MODERN DIGITAL",
    styles: [
      { id: "abstract", name: "Abstract", image: abstractImage, description: "Fluid forms and colors" },
      { id: "digital", name: "Digital/Cyber", image: digitalImage, description: "Neon and wireframes" },
      { id: "8bit-pixel", name: "8-Bit Pixel Art", image: pixelArtImage, description: "Retro gaming graphics" },
      { id: "anime", name: "Anime", image: animeImage, description: "Japanese animation style" },
      { id: "claymation", name: "Claymation", image: claymationImage, description: "3D clay animation" },
      { id: "vector", name: "Vector Art", image: vectorImage, description: "Clean geometric shapes" },
      { id: "lowpoly", name: "Low-Poly", image: lowPolyImage, description: "Minimalist 3D polygons" },
      { id: "glitch", name: "Glitch Art", image: glitchImage, description: "Digital corruption" },
    ]
  },
  {
    name: "DREAM & MIND",
    styles: [
      { id: "psychedelic", name: "Psychedelic", image: psychedelicImage, description: "Mind-bending patterns" },
      { id: "italian-brain-rot", name: "Italian Brain Rot", image: italianBrainRotImage, description: "Chaotic viral vibes" },
      { id: "cartoon", name: "Cartoon", image: cartoonImage, description: "Bold, animated style" },
      { id: "expressionism", name: "Expressionism", image: expressionismImage, description: "Emotional intensity" },
      { id: "opart", name: "Op Art", image: opArtImage, description: "Optical illusions" },
      { id: "fantasy", name: "Fantasy", image: fantasyImage, description: "Magical realms" },
      { id: "optical-illusion", name: "Optical Illusions", image: opticalIllusionImage, description: "Visual tricks" },
      { id: "minimalist", name: "Minimalist", image: minimalistImage, description: "Simple and clean" },
    ]
  },
  {
    name: "REALISM & NATURE",
    styles: [
      { id: "realism", name: "Realism", image: realismImage, description: "Lifelike and detailed" },
      { id: "photorealism", name: "Photorealism", image: photorealismImage, description: "Photo-like quality" },
      { id: "landscape", name: "Landscape", image: landscapeImage, description: "Natural scenery" },
      { id: "portrait", name: "Portrait", image: portraitImage, description: "Human focus" },
      { id: "wildlife", name: "Wildlife", image: wildlifeImage, description: "Animals in nature" },
      { id: "stilllife", name: "Still Life", image: stillLifeImage, description: "Objects and arrangements" },
      { id: "hyperrealism", name: "Hyperrealism", image: hyperrealismImage, description: "Beyond photographic" },
      { id: "botanical", name: "Botanical", image: botanicalImage, description: "Plant illustrations" },
    ]
  },
  {
    name: "DARK & MOODY",
    styles: [
      { id: "horror", name: "Horror", image: horrorImage, description: "Dark and eerie" },
      { id: "gothic", name: "Gothic", image: gothicImage, description: "Dark romanticism" },
      { id: "noir", name: "Noir", image: noirImage, description: "Shadows and mystery" },
      { id: "dark-fantasy", name: "Dark Fantasy", image: darkFantasyImage, description: "Sinister magic" },
      { id: "vaporwave-dark", name: "Vaporwave", image: vaporwaveImage, description: "Nostalgic gloom" },
      { id: "steampunk-shadows", name: "Steampunk Shadows", image: steampunkImage, description: "Industrial darkness" },
      { id: "dystopian", name: "Dystopian", image: dystopianImage, description: "Bleak futures" },
      { id: "macabre", name: "Macabre", image: macabreImage, description: "Grotesque beauty" },
    ]
  },
  {
    name: "SCI-FI & FUTURE",
    styles: [
      { id: "scifi", name: "Sci-Fi", image: sciFiImage, description: "Future technology" },
      { id: "cyberpunk", name: "Cyberpunk", image: cyberpunkImage, description: "Neon dystopia" },
      { id: "retro-futurism", name: "Retro-Futurism", image: retroFuturismImage, description: "Vintage tomorrow" },
      { id: "space-opera", name: "Space Opera", image: spaceOperaImage, description: "Cosmic adventure" },
      { id: "neon-noir", name: "Neon Noir", image: neonNoirImage, description: "Glowing shadows" },
      { id: "biotech", name: "Biotech", image: biotechImage, description: "Organic technology" },
      { id: "holographic", name: "Holographic", image: holographicImage, description: "Light projections" },
      { id: "apocalyptic", name: "Apocalyptic", image: apocalypticImage, description: "End times" },
    ]
  },
  {
    name: "SEASONAL & HOLIDAYS",
    styles: [
      { id: "halloween", name: "Halloween", image: halloweenImage, description: "Spooky season" },
      { id: "christmas", name: "Christmas", image: christmasImage, description: "Winter wonder" },
      { id: "newyear", name: "New Year's Day", image: newYearImage, description: "Fresh beginnings" },
      { id: "mlk", name: "MLK Jr. Day", image: mlkImage, description: "Civil rights tribute" },
      { id: "presidents", name: "Washington's Birthday", image: presidentsImage, description: "Presidential honor" },
      { id: "memorial", name: "Memorial Day", image: memorialImage, description: "Remembrance" },
      { id: "juneteenth", name: "Juneteenth", image: juneteenthImage, description: "Freedom celebration" },
      { id: "independence", name: "Independence Day", image: july4Image, description: "American pride" },
      { id: "labor", name: "Labor Day", image: laborDayImage, description: "Worker appreciation" },
      { id: "columbus", name: "Indigenous Peoples' Day", image: indigenousImage, description: "Native heritage" },
      { id: "veterans", name: "Veterans Day", image: veteransImage, description: "Military honor" },
      { id: "thanksgiving", name: "Thanksgiving", image: thanksgivingImage, description: "Grateful harvest" },
      { id: "ramadan", name: "Ramadan", image: ramadanImage, description: "Holy fasting" },
      { id: "eid-fitr", name: "Eid al-Fitr", image: eidFitrImage, description: "Breaking fast" },
      { id: "eid-adha", name: "Eid al-Adha", image: eidAdhaImage, description: "Festival of sacrifice" },
      { id: "diwali", name: "Diwali", image: diwaliImage, description: "Festival of lights" },
      { id: "lunar-new-year", name: "Lunar New Year", image: lunarNewYearImage, description: "Spring festival" },
      { id: "vesak", name: "Vesak", image: vesakImage, description: "Buddha's birthday" },
      { id: "holi", name: "Holi", image: holiImage, description: "Colors festival" },
      { id: "easter", name: "Easter", image: easterImage, description: "Spring rebirth" },
    ]
  },
  {
    name: "MEME CULTURE",
    styles: [
      { id: "nyancat", name: "Nyan Cat", image: nyanCatImage, description: "Rainbow pop tart cat" },
      { id: "distracted-bf", name: "Distracted Boyfriend", image: distractedBfImage, description: "Relationship drama" },
      { id: "this-is-fine", name: "This Is Fine", image: thisIsFineImage, description: "Dog in fire" },
      { id: "expanding-brain", name: "Expanding Brain", image: expandingBrainImage, description: "Ascending intellect" },
      { id: "doge", name: "Doge", image: dogeImage, description: "Much wow shiba" },
      { id: "pepe", name: "Pepe the Frog", image: pepeImage, description: "Feels good man" },
      { id: "wojak", name: "Wojak", image: wojakImage, description: "Doomer feels" },
      { id: "rickroll", name: "Rickroll", image: rickrollImage, description: "Never gonna give you up" },
    ]
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
    // BUG FIX #3: Don't call onClose() here - wizard state machine handles modal hiding
    // When onStylesChange calls setSetupStep(AUDIO), the style modal naturally hides
    // because it only renders when setupStep === STYLE
    onStylesChange(localSelection, localDynamicMode);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm p-4">
      <Card className="w-full max-w-4xl h-[90vh] flex flex-col relative z-50">
        <div className="flex items-center justify-between p-6 border-b">
          <div>
            <h2 className="text-2xl font-bold">Choose Art Style</h2>
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
                <div className="space-y-8 pb-2">
                  {styleGroups.map((group) => (
                    <div key={group.name}>
                      <h3 className="text-sm font-bold text-muted-foreground mb-3 tracking-wide">
                        {group.name}
                      </h3>
                      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                        {group.styles.map((style) => {
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
                    </div>
                  ))}
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
