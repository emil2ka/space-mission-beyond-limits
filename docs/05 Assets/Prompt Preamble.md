# Prompt Preamble (paste at the start of EVERY generator prompt)

Style 5 — cel-shaded comic ([0008 Cel-shaded comic style](../06%20Decisions/0008%20Cel-shaded%20comic%20style.md)).

```text
STYLE RULE — apply to EVERY model/image in this request:
Game: "Space Mission: Beyond Limits". Cel-shaded comic 3D game look.
- Thick black ink outlines on every silhouette and major edge.
- Flat bold colours with 2-3 tone cel shading; halftone dot shading in the darkest shadows. No glossy PBR, no photo textures.
- Palette: cream-white hardware, purple-grey and graphite parts, teal and warm orange accents, muted gold for insulation. Titan scenes are orange/amber haze; space is deep navy.
- Shapes: chunky, readable, slightly exaggerated. NO thin fragile parts: rotor blades, antenna rods, cables and struts are thick (so outlines don't break).
- Crew: one chunky astronaut design (~5 heads tall), role colour on chevrons + helmet stripe: Commander pink, Engineer orange, Science teal, Comms lavender.
- Technical (3D): units = metres, Y up, front = +Z, origin = attachment point. Moving parts named "pivot_<name>" with the pivot at the real hinge; effect points "fx_<name>". Flat-colour materials (one colour per material), separate "M_Emissive" for lights. Triangle budget: module <= 4k, craft <= 15k, character <= 10k.
- Export: one GLB per model, each with its own "COPY GLB · BASE64" button.
```

The previous option (a lavender "premium toy") was rejected on 2026-11-13.
