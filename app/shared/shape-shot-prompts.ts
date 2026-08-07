import type { ProductShape, Shot, ShotPromptOverride } from "./types";

type Shape = Exclude<ProductShape, "area">;
export interface ShapeShotPromptOverride extends Required<ShotPromptOverride> {
  crop_lock?: string;
  fold_geometry?: string;
  fringe_tassel_lock?: string;
  edge_strip_lock?: string;
  label_placement?: string;
  label_geometry_lock?: string;
}

export interface ShapeShotProfile {
  id: string;
  label: string;
  purpose: string;
  override: ShapeShotPromptOverride;
  validationChecks: string[];
  rejectConditions: string[];
  recommendedBackgroundTypes: string[];
}

export interface ShapeShotContext {
  shape: Shape;
  profile: ShapeShotProfile;
  override: ShapeShotPromptOverride;
  identityInstruction: string;
  backgroundCompatibility: "recommended" | "usable";
  customPromptActive: boolean;
}

interface ShapeShotDefinition {
  purpose: string;
  override: ShapeShotPromptOverride;
  validationChecks: string[];
  rejectConditions: string[];
}

const RUNNER_BACKGROUND_TYPES = [
  "runner_foyer",
  "runner_hallway",
  "foyer",
  "hallway",
  "bedroom",
  "architectural_living"
];
const ROUND_BACKGROUND_TYPES = ["interior_living", "architectural_living"];

const RUNNER_SHARED_CHECKS = [
  "Exactly one approved Runner rug is present.",
  "The rug still reads as a genuinely long manufactured Runner, with its approved body ratio, motif scale, borders, edge finish, and fringe topology unchanged.",
  "Perspective, crop, furniture, and shadows do not disguise the Runner as an Area rug or compress its long axis."
];

const RUNNER_SHARED_REJECTIONS = [
  "Reject a square, near-square, Area-rug, Round, oval, stretched, squeezed, shortened, or widened rug.",
  "Reject an end-on camera angle that makes the Runner look short, a crop that removes every cue to its long format, or furniture that hides identity-critical ends, borders, or motifs.",
  "Reject moved fringe, fringe added to a long side, altered border width, resized motifs, changed color placement, or a redesigned end treatment."
];

const ROUND_SHARED_CHECKS = [
  "Exactly one approved Round rug is present.",
  "The manufactured rug remains truly circular in floor geometry, with its approved radial layout, motif scale, perimeter finish, material, and colors unchanged.",
  "Any perspective ellipse is caused only by a physically plausible camera angle; the product itself is never ovalized."
];

const ROUND_SHARED_REJECTIONS = [
  "Reject a square, rectangle, Runner, polygon, scalloped shape, artificial perfect ellipse, cropped disc, or circular mask applied to a rectangular rug.",
  "Reject a fabricated square corner, straight perimeter segment, center hole, pie-slice seam, radialized motif, or new concentric border absent from Image 1.",
  "Reject altered edge finish, redistributed fringe, resized motifs, changed color placement, or furniture that prevents the circular identity from being judged."
];

const RUNNER_DEFINITIONS: Record<string, ShapeShotDefinition> = {
  wide_room_hero: {
    purpose: "Show the complete Runner naturally installed in a room while keeping its long-format silhouette immediately readable.",
    override: {
      scene:
        "Shape-specific Runner wide lifestyle hero. Reconstruct the selected background faithfully as secondary room context; do not replace its architecture or furniture style. Use an existing clear circulation path, hallway axis, foyer lane, bedside passage, or open floor run that can physically accommodate the approved Runner. Keep furniture outside the Runner footprint and never invent a sofa, coffee table, dining table, or bed arrangement that conflicts with the selected room.",
      rug_placement:
        "Lay the complete Runner flat along the room's clearest long circulation axis. Within the square output, compose its long body broadly across the lower or middle field, or on only a gentle diagonal, so both short ends and both long edges remain visible with a narrow believable floor margin. Preserve the approved Runner body ratio exactly. Do not tuck it under large furniture, place it wall-to-wall, bend it around a corner, or shorten it to fill the frame.",
      camera:
        "Use a waist-to-chest-height interior product camera with a controlled 30-45 degree downward view and a natural 35-50mm full-frame lens feel. View the Runner from across one long side or a mild three-quarter angle, never directly end-on down its long axis. Keep vertical architecture controlled and avoid wide-angle stretching or strong foreshortening; the long-to-short proportion must remain easy to judge.",
      lighting:
        "Preserve the selected room's natural light direction and practical-light state. Use soft floor contact shadows along the long edges and short ends, readable pile direction, and even exposure across the full Runner without changing its colors or obscuring its perimeter.",
      styling:
        "Premium editorial interior catalogue photography. Keep the Runner the dominant product, use restrained room-faithful styling, maintain realistic walking clearances, and avoid clutter, props on the rug, or furniture overlap that hides the shape.",
      quality:
        "Photorealistic Runner installation with accurate long-format geometry, physically plausible room scale, controlled perspective, crisp edge topology, grounded contact, and no CGI sheen.",
      output_requirements:
        "The final image must unmistakably show the approved Runner—not an Area rug—installed naturally in the selected room. One complete Runner only; preserve its exact body ratio, design layout, motif scale, border width, edge finish, fringe placement, material, and color map from Image 1."
    },
    validationChecks: [
      "Both short ends and both long edges are visible and the complete perimeter can be judged.",
      "The camera looks across a long side or from a mild three-quarter angle rather than end-on.",
      "The Runner occupies a believable circulation path and remains clear of large furniture."
    ],
    rejectConditions: [
      "Reject if the room is changed into a generic hallway or dining room instead of preserving the selected background.",
      "Reject if the Runner is too thin to inspect, heavily foreshortened, placed beneath a large table or bed, or cropped at either short end."
    ]
  },
  high_angle_lifestyle: {
    purpose: "Prove the Runner's complete long-format geometry and design rhythm from a high, natural lifestyle angle.",
    override: {
      scene:
        "Shape-specific Runner high-angle lifestyle shot. Preserve the selected background faithfully and use its real hallway, foyer, bedside passage, galley transition, or longest open floor lane as secondary context. Do not redesign the room or add furniture that blocks the Runner.",
      rug_placement:
        "Show the complete Runner flat with both short ends, both long edges, and all fringe or binding visible. In a square frame, place the long axis on a restrained corner-to-corner diagonal or across the widest usable floor span to maximize product scale while retaining a narrow floor margin. Keep the long sides straight and parallel in the manufactured rug; do not bow, taper, widen, or shorten the body.",
      camera:
        "Use a standing-height 60-75 degree downward three-quarter view with a natural 45-70mm full-frame lens feel. Center the camera near the Runner's midpoint and rotate the composition rather than shooting from an end. Avoid ceiling-view flatness, extreme wide-angle distortion, and long-axis foreshortening.",
      lighting:
        "Use soft directional room light with restrained shadows that reveal pile and edge thickness while keeping every color region and the complete perimeter legible.",
      styling:
        "Clean premium lifestyle product photography with minimal secondary furnishings at the outer frame only. Maintain clear walking space around the Runner and place no objects on it.",
      quality:
        "Photorealistic high-angle Runner photograph with full-shape legibility, correct long-body perspective, precise pattern continuity, natural material texture, and no compositing artifacts.",
      output_requirements:
        "Deliver one complete approved Runner in a believable room, viewed high enough to verify the long silhouette and design continuity. Preserve the exact approved ratio and product identity; do not substitute, repeat, or crop the rug."
    },
    validationChecks: [
      "The full Runner fits at useful scale in the square frame, preferably across the broad field or on a restrained diagonal.",
      "Long sides remain visually straight and both short-end treatments are readable.",
      "The high angle reveals the complete design without flattening the image into an orthographic catalog cutout."
    ],
    rejectConditions: [
      "Reject an end-on composition, missing short end, exaggerated trapezoid, or near-square appearance.",
      "Reject props, shoes, furniture, or decor placed on the Runner."
    ]
  },
  studio_corner_detail: {
    purpose: "Inspect a Runner short end, the adjacent long edge, and pile construction without losing long-format cues.",
    override: {
      crop_lock:
        "RUNNER DETAIL CROP LOCK: the frame is a physical camera boundary around one authentic short-end-to-long-edge junction of the approved Runner. Show only a local construction region. The long body must continue beyond one image boundary and the short-end finish must remain truthful to Image 1. Do not target a generic top-left corner, fit the whole Runner inside the canvas, complete both long edges, or miniaturize the product.",
      scene:
        "Shape-specific Runner studio construction detail on a seamless pure white field. Show one authentic short-end corner area and a substantial continuation of the adjacent long edge. No room, wall, floor texture, props, detached background shapes, or decorative shadows.",
      rug_placement:
        "Keep the Runner flat. Include one complete short-end finish or a clearly readable portion of it, the true short-end-to-long-edge junction, and enough continuing long body to establish direction. This is a truthful camera crop of the approved Runner, not a redesigned corner and not the whole rug squeezed into a detail frame.",
      camera:
        "Use a low 20-35 degree oblique camera positioned across the long edge and looking toward the short-end junction, with a 70-100mm macro/product lens feel. Keep the edge tangent, thickness, pile transition, binding, and any original short-end fringe sharply readable; let the long body continue naturally out of frame.",
      lighting:
        "Use a large soft source raking gently across the pile with neutral white balance, restrained edge contact shadow, and enough depth of field to read construction without flattening or recoloring the fibers.",
      styling:
        "Clinical premium textile product photography on pure white. No props, hands, tools, clips, labels unless already part of the photographed edge, or artificial set dressing.",
      quality:
        "High-resolution material detail with truthful edge construction, crisp fiber separation, realistic pile depth, natural handmade variation, and no synthetic sharpening or CGI surface.",
      output_requirements:
        "The crop must belong unmistakably to the approved Runner: preserve its short-end finish, long-edge topology, local motif scale, colors, and material. Do not create a square corner treatment or move fringe from a short end onto a long side.",
      fringe_tassel_lock:
        "RUNNER EDGE-TOPOLOGY LOCK: inspect Image 1 and preserve its approved short-end treatment exactly. Fringe may appear only on the equivalent short end or ends where it exists in Image 1; a long side remains bound or finished exactly as approved. Never copy, rotate, mirror, or wrap short-end fringe onto a long edge."
    },
    validationChecks: [
      "One short-end-to-long-edge junction is readable.",
      "Enough long body continues through the crop to retain Runner directionality.",
      "The studio field is pure white and free of detached shadows or background objects."
    ],
    rejectConditions: [
      "Reject a generic square rug corner, a full miniature Runner, or a crop with no evidence of the long edge.",
      "Reject fringe on a long side or a newly invented edge binding."
    ]
  },
  texture_macro: {
    purpose: "Document the Runner's actual pile, weave, and local motif scale without asking the macro to prove the whole silhouette.",
    override: {
      scene:
        "Shape-specific Runner texture macro on a featureless pure white studio field. Photograph only a representative interior textile section from the approved Runner; no room, props, tools, hands, detached fabric swatches, or unrelated rug edges.",
      rug_placement:
        "Keep the Runner flat and photograph a true local section at real material scale. Preserve the exact local motif proportions, color boundaries, fiber direction, pile height, and weave visible in Image 1. Do not compress the full Runner design into the macro and do not invent an edge, corner, fringe, seam, or curvature unless that exact feature belongs to the selected local section.",
      camera:
        "Use a near-surface 80-120mm macro lens feel at a shallow 15-30 degree angle, with focus on fibers and pile transition and natural falloff beyond the focal plane. The image is a camera crop from the approved Runner, not a generated material tile.",
      lighting:
        "Use soft cross-light that reveals fiber height, yarn direction, and weave relief with neutral color reproduction, controlled highlights, and no crushed shadows.",
      styling:
        "Archival textile macro photography with no embellishment, wet sheen, glitter, artificial fuzz, exaggerated pile, or decorative styling.",
      quality:
        "Photorealistic high-resolution fiber detail with accurate material scale, natural depth of field, restrained sharpening, and no repeated texture cloning.",
      output_requirements:
        "Return one truthful macro crop of the approved Runner material and design. Preserve the exact local palette and motif scale; do not use this shot to alter, summarize, or reinterpret the overall Runner pattern."
    },
    validationChecks: [
      "Fiber, pile, weave, and color boundaries match the approved Runner at believable physical scale.",
      "The macro reads as one continuous rug surface rather than a detached swatch or repeated texture tile.",
      "No false edge, corner, fringe, or entire miniature silhouette is introduced."
    ],
    rejectConditions: [
      "Reject a full-rug view, tiled texture, liquified fibers, synthetic fuzz, or changed motif scale.",
      "Reject added edge geometry used merely to signal that the product is a Runner."
    ]
  },
  folded_label_detail: {
    purpose: "Show the Runner's authentic underside and sewn label at one short end while preserving the long-edge construction.",
    override: {
      fold_geometry:
        "RUNNER FOLD GEOMETRY: lift and fold back one shallow strip from one authentic short end, keeping the fold line approximately parallel to that short edge. The adjacent long body stays flat and visibly continues away from the fold. This is not a corner fold and not a fold along a long side. Preserve one continuous rug body with plush front outside and compact hand-knotted reverse exposed; never add a second textile layer or backing sheet.",
      fringe_tassel_lock:
        "RUNNER FRINGE/EDGE LOCK: preserve the exact approved treatment of the folded short end. If Image 1 has fringe there, keep every visible strand attached to that short edge with the same color, density, length, twist, spacing, and handmade irregularity. Never move, mirror, or wrap fringe onto either long side, and never invent fringe if the approved Runner has binding instead.",
      edge_strip_lock:
        "RUNNER FOLDED-EDGE LOCK: add no stacked strips, wide tape, piping, rails, sleeves, pale bars, or secondary backing across the folded short end or either long edge. The hand-knotted foundation must run continuously to the authentic short edge; only the supplied sewn label may form a separate cloth rectangle.",
      label_placement:
        "RUNNER LABEL PLACEMENT: attach the sewn cloth label only to the exposed woven underside of the shallow short-end flap, centered clear of fringe roots, binding, and the fold line. Never place it on the plush front, a long side, the main flat rug surface, or a detached patch.",
      label_geometry_lock:
        "RUNNER LABEL GEOMETRY: use one off-white sewn rectangular cloth label in 4:3 landscape orientation with straight edges and a subtle stitched border. Keep it flat on the exposed short-end underside, with its long edge parallel to the folded short edge and an even margin from the fold and side boundaries. Use the supplied artwork exactly; do not rotate, warp, curve, duplicate, or float the label.",
      scene:
        "Shape-specific Runner folded-label studio detail on a seamless pure white field. Show one short end of the approved Runner gently folded back just enough to reveal its authentic underside and sewn cloth label. No room, props, hands, clips, tools, packaging, or decorative background objects.",
      rug_placement:
        "Fold back only a shallow section of one true short end. Keep the opposite long body flat and let both long edges continue in their correct direction. Preserve the original short-end fringe or binding and keep fringe attached to its real edge. The fold must not migrate to a long side, create a second fringed edge, expose an impossible backing, or make the Runner appear square.",
      camera:
        "Use a controlled 35-50 degree overhead-oblique product camera with a 60-90mm lens feel, framed tightly around the folded short end, label, underside, and enough adjacent long body to prove orientation. Keep label geometry readable without flattening the textile.",
      lighting:
        "Use soft neutral studio light with realistic fold shadows, fiber detail, and white balance. Preserve label contrast and rug colors without glare, crushed blacks, or floating edges.",
      styling:
        "Premium e-commerce construction detail. The fold is tidy but physically natural; no hands, fasteners, tape, invented backing fabric, or excessive sculpting.",
      quality:
        "Photorealistic folded textile construction with accurate thickness, gravity, underside, stitch contact, label integration, short-end finish, and no compositing seams.",
      output_requirements:
        "Show the exact approved Runner and exact supplied label artwork at one authentic short-end fold. Preserve long-edge topology, short-end fringe or binding, product ratio cues, colors, material, and local design; do not fabricate or relocate any edge treatment."
    },
    validationChecks: [
      "The fold begins at one real short end and the adjacent long body remains directionally clear.",
      "The sewn label is attached to the exposed underside, lies in the textile plane, and uses the supplied artwork exactly.",
      "Original fringe or binding remains attached to the correct short edge."
    ],
    rejectConditions: [
      "Reject a fold along a long side, a square-rug presentation, detached or floating label, or invented second fringe edge.",
      "Reject a fold so large that it hides the Runner orientation or visibly redesigns the front pattern."
    ]
  }
};

const ROUND_DEFINITIONS: Record<string, ShapeShotDefinition> = {
  wide_room_hero: {
    purpose: "Show the complete Round rug as a believable room anchor while preserving its true circular floor geometry.",
    override: {
      scene:
        "Shape-specific Round wide lifestyle hero. Reconstruct the selected background faithfully as secondary room context; do not replace its architecture, lighting, or furniture style. Use an existing open foyer zone, seating zone, dining nook, or clear floor bay that physically accommodates the approved Round rug. Rebalance only movable small furniture when necessary to reveal the rug; do not invent a round table or a new room type merely because the rug is circular.",
      rug_placement:
        "Lay the complete Round rug flat as the room's visible floor anchor with its entire continuous circular perimeter readable and a narrow believable floor halo around it. Keep major furniture outside the perimeter; at most, allow minimal physically plausible contact from light chair legs at the outer edge without covering identity-critical design. Do not crop the circle, tuck it deeply under a sofa or bed, or mask a rectangular rug into a disc.",
      camera:
        "Use a controlled elevated interior product camera with a 35-50 degree downward view and a natural 35-50mm full-frame lens feel, aimed near the rug center. The real rug is circular; a mild perspective ellipse is physically correct at this angle, but avoid a low end-on view, extreme wide-angle distortion, or framing that makes the product look strongly oval. Keep room verticals controlled.",
      lighting:
        "Preserve the selected room's natural light direction and practical-light state. Use soft continuous perimeter contact shadows and even exposure across the circle so the edge finish, pile, colors, and radial design relationships remain readable.",
      styling:
        "Premium editorial interior catalogue photography. Keep the Round rug dominant, preserve room-faithful styling, leave the center visually open, and avoid clutter, props on the rug, or furniture arrangements that hide its circular identity.",
      quality:
        "Photorealistic Round-rug installation with true circular floor geometry, controlled perspective, continuous perimeter, accurate radial design, grounded contact, and no CGI sheen.",
      output_requirements:
        "The final image must unmistakably show the one approved Round rug installed naturally in the selected room. Preserve its exact circular product geometry, design layout, motif scale, perimeter finish, fringe policy, material, and color map from Image 1; never substitute an oval or circular crop of a rectangular design."
    },
    validationChecks: [
      "The complete continuous circular perimeter and a narrow floor halo are visible.",
      "The camera is elevated enough to communicate a Round product while retaining believable room perspective.",
      "The selected room remains recognizable and no invented round table or new room type is introduced."
    ],
    rejectConditions: [
      "Reject if major furniture hides the center or enough perimeter that circular geometry cannot be judged.",
      "Reject a mathematically perfect front-facing disc pasted onto an oblique floor or a strongly oval product caused by an excessively low camera."
    ]
  },
  high_angle_lifestyle: {
    purpose: "Verify the Round rug's complete circular silhouette and design balance from a natural high lifestyle angle.",
    override: {
      scene:
        "Shape-specific Round high-angle lifestyle shot. Preserve the selected background faithfully and use its open foyer, dining nook, seating bay, or clearest floor zone as secondary context. Keep furniture outside the main circle and do not add a round table or radial furniture arrangement absent from the selected room.",
      rug_placement:
        "Show the complete Round rug flat, centered in a clear floor zone, with its whole continuous perimeter and balanced negative space visible. The design must remain the approved circular composition; do not crop, ovalize, rotate individual motifs, add radial repeats, or derive a circle by masking the Area design.",
      camera:
        "Use a standing or slightly elevated 65-80 degree downward three-quarter view with a natural 45-70mm full-frame lens feel, centered close to the rug's geometric center. Keep a trace of room depth rather than a flat scan, but use enough elevation to make the circular product unmistakable and avoid strong oval distortion.",
      lighting:
        "Use soft directional room light with restrained perimeter shadow, clear pile relief, and even color rendering across the complete circle.",
      styling:
        "Clean premium lifestyle product photography with sparse room context at the outer frame only. Maintain uncluttered negative space around the circle and place no props or furniture on the rug.",
      quality:
        "Photorealistic high-angle Round-rug photograph with full-shape legibility, true circular geometry under perspective, precise radial design continuity, and natural material detail.",
      output_requirements:
        "Deliver one complete approved Round rug in a believable room, viewed high enough to verify the circular silhouette and design balance. Preserve the exact approved product identity and perimeter treatment; do not crop, mask, duplicate, or ovalize it."
    },
    validationChecks: [
      "The full circle fits at useful scale with even floor clearance around the perimeter.",
      "The view retains slight room depth while remaining high enough to judge circularity.",
      "Radial, centered, asymmetrical, or directional design relationships remain exactly as approved."
    ],
    rejectConditions: [
      "Reject a cropped circumference, low-angle ellipse, overhead flat catalog cutout, or furniture-covered center.",
      "Reject newly radialized motifs, concentric bands, or rotational symmetry not present in the approved Round base."
    ]
  },
  studio_corner_detail: {
    purpose: "Inspect the Round rug's continuous curved perimeter, edge finish, thickness, and pile transition without inventing a corner.",
    override: {
      crop_lock:
        "ROUND PERIMETER CROP LOCK: the frame is a physical camera boundary around one authentic curved arc of the approved Round rug. Show only a local perimeter construction region. The circular edge must enter and leave the frame as one continuous curve while the rug interior continues beyond the crop. Do not target a top-left corner, create any complete corner unit, fit the whole Round rug inside the canvas, or flatten the arc into a straight side.",
      scene:
        "Shape-specific Round perimeter construction detail on a seamless pure white field. Show one continuous authentic arc of the approved circular perimeter and the adjacent interior pile. No room, wall, floor texture, props, detached background shapes, or decorative shadows.",
      rug_placement:
        "Keep the Round rug flat. Frame a truthful camera crop containing a substantial curved perimeter arc, realistic edge thickness, binding or fringe treatment, and enough interior design to establish local scale. The curve must continue naturally beyond both sides of the crop; never flatten it into a straight edge or fabricate a square corner.",
      camera:
        "Use a low 20-35 degree oblique camera tangent to the circular perimeter with a 70-100mm macro/product lens feel. Keep the curved edge, thickness, pile transition, binding, and any original perimeter fringe sharply readable while the arc continues naturally out of frame.",
      lighting:
        "Use a large soft source raking gently across the pile and curved edge, with neutral white balance, restrained contact shadow, and enough depth of field to read construction without flattening or recoloring fibers.",
      styling:
        "Clinical premium textile product photography on pure white. No props, hands, tools, clips, labels unless already part of the edge, or artificial set dressing.",
      quality:
        "High-resolution curved-edge material detail with truthful perimeter construction, crisp fiber separation, realistic pile depth, and no synthetic sharpening or CGI surface.",
      output_requirements:
        "The crop must belong unmistakably to the approved Round rug: preserve its continuous circular arc, edge treatment, local motif scale, colors, and material. Do not create a square corner, straight side, scallop, or invented fringe treatment.",
      fringe_tassel_lock:
        "ROUND PERIMETER-TOPOLOGY LOCK: preserve the exact approved edge treatment visible in Image 1 all along the photographed arc. If the approved Round rug is bound, keep the arc bound with no fringe. If it has approved radial fringe, preserve that fringe's color, density, length, attachment, and radial direction. Never borrow a straight-edge or corner fringe layout from the Area source."
    },
    validationChecks: [
      "A continuous curved perimeter arc is clearly readable and continues beyond the crop.",
      "Edge thickness, binding or fringe, and adjacent interior pile match the approved Round product.",
      "The studio field is pure white and free of detached shadows or background objects."
    ],
    rejectConditions: [
      "Reject any square corner, straight edge segment presented as the product boundary, polygonal arc, or miniature full rug.",
      "Reject new scallops, radial fringe, or contrast binding absent from the approved base."
    ]
  },
  texture_macro: {
    purpose: "Document the Round rug's actual pile, weave, and local motif scale without forcing artificial radial cues into a macro.",
    override: {
      scene:
        "Shape-specific Round texture macro on a featureless pure white studio field. Photograph only a representative interior textile section from the approved Round rug; no room, props, tools, hands, detached fabric swatches, or unrelated rug edges.",
      rug_placement:
        "Keep the Round rug flat and photograph a true local section at real material scale. Preserve the exact local motif proportions, color boundaries, fiber direction, pile height, and weave visible in Image 1. Do not compress the full circular design into the macro, invent radial lines or concentric rings, or introduce a perimeter edge unless that exact feature belongs to the selected section.",
      camera:
        "Use a near-surface 80-120mm macro lens feel at a shallow 15-30 degree angle, with focus on fibers and pile transition and natural falloff beyond the focal plane. The image is a camera crop from the approved Round rug, not a generated circular material swatch.",
      lighting:
        "Use soft cross-light that reveals fiber height, yarn direction, and weave relief with neutral color reproduction, controlled highlights, and no crushed shadows.",
      styling:
        "Archival textile macro photography with no embellishment, wet sheen, glitter, artificial fuzz, exaggerated pile, radial styling, or decorative props.",
      quality:
        "Photorealistic high-resolution fiber detail with accurate material scale, natural depth of field, restrained sharpening, and no repeated texture cloning.",
      output_requirements:
        "Return one truthful macro crop of the approved Round-rug material and design. Preserve the exact local palette and motif scale; do not radialize, summarize, or reinterpret the overall circular composition."
    },
    validationChecks: [
      "Fiber, pile, weave, and color boundaries match the approved Round rug at believable physical scale.",
      "The macro reads as one continuous rug surface rather than a circular swatch or repeated texture tile.",
      "No false perimeter, radial motif, concentric ring, or miniature silhouette is introduced."
    ],
    rejectConditions: [
      "Reject a full-rug view, circular sample swatch, tiled texture, liquified fibers, or changed motif scale.",
      "Reject artificial radial cues added merely to signal that the product is Round."
    ]
  },
  folded_label_detail: {
    purpose: "Show the Round rug's authentic underside and sewn label at a shallow perimeter-arc fold without fabricating a corner.",
    override: {
      fold_geometry:
        "ROUND FOLD GEOMETRY: lift one small shallow arc segment of the authentic circular perimeter and fold it inward as one continuous curved flap. The fold chord remains local, the surrounding circular edge stays visible on both sides, and the main rug remains flat. Never create a square corner, triangular pie-slice flap, straight outer side, missing wedge, second rug layer, or attached backing sheet.",
      fringe_tassel_lock:
        "ROUND FRINGE/EDGE LOCK: preserve the approved perimeter treatment through the folded arc. If Image 1 is bound, keep the curve bound with no fringe. If it has approved radial fringe, keep visible strands attached around the arc with matching color, density, length, spacing, and radial direction. Do not invent, straighten, bunch, or relocate fringe.",
      edge_strip_lock:
        "ROUND FOLDED-ARC LOCK: add no stacked perimeter strips, wide tape, piping, rails, sleeves, pale bars, polygonal edging, or secondary backing around the curved flap. The hand-knotted foundation must run continuously to the authentic circular edge; only the supplied sewn label may form a separate cloth rectangle.",
      label_placement:
        "ROUND LABEL PLACEMENT: attach the sewn cloth label only to the exposed woven underside of the shallow curved flap, centered clear of the perimeter finish and fold line. Never place it on the plush front, the main flat rug surface, outside the circular boundary, or on a detached patch.",
      label_geometry_lock:
        "ROUND LABEL GEOMETRY: use one off-white sewn rectangular cloth label in 4:3 landscape orientation with straight edges and a subtle stitched border. Keep it flat on the exposed curved flap, with its long edge approximately tangent to the nearby circular perimeter and an even margin from the fold and edge treatment. The rug edge remains curved while the label remains rectangular. Use the supplied artwork exactly; do not curve, warp, duplicate, or float the label.",
      scene:
        "Shape-specific Round folded-label studio detail on a seamless pure white field. Show one shallow arc of the approved circular perimeter gently folded back just enough to reveal its authentic underside and sewn cloth label. No room, props, hands, clips, tools, packaging, or decorative background objects.",
      rug_placement:
        "Fold back only a small shallow arc of the true circular perimeter. Keep the surrounding rug flat so the continuous curve remains obvious on both sides of the fold. Preserve the original binding or fringe policy around the arc. The fold must not create a square corner, wedge-shaped missing section, straight side, second rug layer, impossible backing, or relocated fringe.",
      camera:
        "Use a controlled 40-55 degree overhead-oblique product camera with a 60-90mm lens feel, framed tightly around the curved fold, label, underside, and enough adjacent perimeter to prove circular continuity. Keep label geometry readable without flattening the textile.",
      lighting:
        "Use soft neutral studio light with realistic fold shadows, fiber detail, and white balance. Preserve label contrast and rug colors without glare, crushed blacks, floating edges, or a detached shadow under the arc.",
      styling:
        "Premium e-commerce construction detail. The fold is tidy but physically natural; no hands, fasteners, tape, invented backing fabric, radial staging, or excessive sculpting.",
      quality:
        "Photorealistic folded textile construction with accurate curved-edge thickness, gravity, underside, stitch contact, label integration, and no compositing seams.",
      output_requirements:
        "Show the exact approved Round rug and exact supplied label artwork at one authentic shallow perimeter-arc fold. Preserve circular continuity, edge finish, fringe policy, colors, material, and local design; never fabricate a square corner or straight edge."
    },
    validationChecks: [
      "The fold follows a real shallow perimeter arc and the circular curve remains continuous on both sides.",
      "The sewn label is attached to the exposed underside, lies in the textile plane, and uses the supplied artwork exactly.",
      "Original binding or fringe treatment remains consistent around the visible perimeter."
    ],
    rejectConditions: [
      "Reject a square-corner fold, pie-slice flap, straight folded side, detached label, or invented second perimeter.",
      "Reject a fold so large that it hides circular continuity or redesigns the front pattern."
    ]
  }
};

const FALLBACK_DEFINITIONS: Record<Shape, ShapeShotDefinition> = {
  runner: {
    purpose: "Apply a mandatory long-format Runner composition contract to this custom shot.",
    override: {
      scene: "Preserve the operator's requested scene only where it can physically and photographically accommodate the approved Runner without changing the product or room identity.",
      rug_placement: "Keep the approved Runner flat and preserve its exact long body ratio, both short ends, both long edges, edge finish, fringe topology, design layout, motif scale, material, and colors. Use cropping only when the requested shot is explicitly a detail.",
      camera: "Choose a camera across the Runner's long side or at a mild three-quarter angle. Avoid end-on foreshortening, wide-angle stretching, or any view that makes the Runner appear square or Area-sized.",
      lighting: "Use realistic light and contact shadows that preserve the Runner's color map, material, pile, and readable edge topology.",
      styling: "Keep all styling secondary to the approved Runner and avoid props or furniture that hide identity-critical geometry or design.",
      quality: "Photorealistic product photography with accurate Runner geometry, material scale, perspective, and grounded contact.",
      output_requirements: "Return the one exact approved Runner product in the requested shot. Never convert it into an Area or Round rug, redesign it, stretch it, or relocate its edge treatment."
    },
    validationChecks: ["The Runner's long-format identity remains judgeable in the requested shot."],
    rejectConditions: ["Reject any result that appears square, shortened, widened, end-on, or generically Area-shaped."]
  },
  round: {
    purpose: "Apply a mandatory true-circular Round-rug composition contract to this custom shot.",
    override: {
      scene: "Preserve the operator's requested scene only where it can physically and photographically accommodate the approved Round rug without changing the product or room identity.",
      rug_placement: "Keep the approved Round rug flat and preserve its true circular floor geometry, continuous perimeter, edge finish, design layout, motif scale, material, and colors. Use cropping only when the requested shot is explicitly a detail.",
      camera: "Choose enough camera elevation to communicate the circular product under believable perspective. Avoid extreme low angles, wide-angle distortion, or framing that makes the rug strongly oval, square, rectangular, or cropped into an ambiguous shape.",
      lighting: "Use realistic light and continuous perimeter contact shadows that preserve the Round rug's color map, material, pile, and edge topology.",
      styling: "Keep all styling secondary to the approved Round rug and avoid props or furniture that hide its circular identity or design.",
      quality: "Photorealistic product photography with true circular floor geometry, accurate material scale, controlled perspective, and grounded contact.",
      output_requirements: "Return the one exact approved Round rug in the requested shot. Never ovalize it, mask a rectangular rug into a disc, invent radial design, or alter its perimeter treatment."
    },
    validationChecks: ["The Round rug's true circular product identity remains judgeable in the requested shot."],
    rejectConditions: ["Reject any result that appears ovalized, square, rectangular, polygonal, or generically Area-shaped."]
  }
};

const RECOMMENDED_BACKGROUND_TYPES: Record<Shape, string[]> = {
  runner: RUNNER_BACKGROUND_TYPES,
  round: ROUND_BACKGROUND_TYPES
};

function definitionsFor(shape: Shape) {
  return shape === "runner" ? RUNNER_DEFINITIONS : ROUND_DEFINITIONS;
}

export function shapeShotDisplayName(shape: ProductShape, shotName: string) {
  if (shape === "area") return shotName;
  return `${shape === "runner" ? "Runner" : "Round"} · ${shotName}`;
}

export function resolveShapeShotProfile(shape: Shape, shot: Shot): ShapeShotProfile {
  const definition = definitionsFor(shape)[shot.id] ?? FALLBACK_DEFINITIONS[shape];
  return {
    id: `${shape}_${shot.id}`,
    label: shapeShotDisplayName(shape, shot.name),
    purpose: definition.purpose,
    override: definition.override,
    validationChecks: [...(shape === "runner" ? RUNNER_SHARED_CHECKS : ROUND_SHARED_CHECKS), ...definition.validationChecks],
    rejectConditions: [...(shape === "runner" ? RUNNER_SHARED_REJECTIONS : ROUND_SHARED_REJECTIONS), ...definition.rejectConditions],
    recommendedBackgroundTypes: [...RECOMMENDED_BACKGROUND_TYPES[shape]]
  };
}

export function resolveShapeShotContext({
  shape,
  shot,
  prompt,
  backgroundType
}: {
  shape: ProductShape;
  shot: Shot;
  prompt: string;
  backgroundType?: string | null;
}): ShapeShotContext | null {
  if (shape === "area") return null;
  const normalizedBackgroundType = backgroundType?.trim().toLowerCase() ?? "";
  const profile = resolveShapeShotProfile(shape, shot);
  return {
    shape,
    profile,
    override: profile.override,
    identityInstruction:
      shape === "runner"
        ? "Image 1 is an approved Runner product and the sole product-identity authority. Preserve its exact manufactured long-format body ratio, short ends, long edges, design layout, motif scale, border width, edge finish, material, color map, and fringe topology in every shot. Never turn it into an Area or Round rug."
        : "Image 1 is an approved Round product and the sole product-identity authority. Preserve its exact manufactured circular floor geometry, continuous perimeter, circular design layout, motif scale, edge finish, material, and color map in every shot. Never turn it into an oval, square, rectangle, polygon, or Runner.",
    backgroundCompatibility: profile.recommendedBackgroundTypes.includes(normalizedBackgroundType) ? "recommended" : "usable",
    customPromptActive: prompt.trim() !== shot.prompt.trim()
  };
}
