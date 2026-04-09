<objective>
Create comprehensive, exhaustive documentation for all VOYO Mode components in the VOYO Music app. This documentation will serve as the technical reference for developers working on the VOYO Mode experience - the app's flagship TikTok-style music player interface.

The documentation must cover every technical detail: props, state, functions, animations, and complex logic with line-by-line explanations.
</objective>

<context>
VOYO Mode is the main music player experience in the app, featuring:
- Portrait and Landscape layouts (auto-detected)
- TikTok-style vertical feed for music discovery
- Video mode with floating reactions
- Creator upload interface
- Bottom navigation system

Tech stack: React 19, TypeScript, Framer Motion, Zustand, Tailwind CSS

Components to document are located in:
- `/src/components/voyo/PortraitVOYO.tsx`
- `/src/components/voyo/LandscapeVOYO.tsx`
- `/src/components/voyo/VideoMode.tsx`
- `/src/components/voyo/VoyoPortraitPlayer.tsx`
- `/src/components/voyo/VoyoSplash.tsx`
- `/src/components/voyo/feed/VoyoVerticalFeed.tsx`
- `/src/components/voyo/navigation/VoyoBottomNav.tsx`
- `/src/components/voyo/upload/CreatorUpload.tsx`
</context>

<requirements>
For EACH component, thoroughly document:

1. **Purpose & Responsibility**: What this component does and why it exists
2. **Props Interface**: Every prop with TypeScript types, default values, and purpose
3. **State Management**:
   - Local state variables (useState)
   - Store subscriptions (Zustand)
   - Refs (useRef) and their purpose
4. **Key Functions/Handlers**:
   - What each function does
   - Parameters and return types
   - Complex logic explained line-by-line
5. **Dependencies**: What it imports and uses
6. **Child Components**: What components it renders
7. **Events**: What events it emits/handles
8. **Animation/Styling**: Framer Motion variants, CSS approaches, animation sequences
9. **Complex Logic Deep-Dive**: For any sophisticated algorithms, state machines, or intricate flows, provide line-by-line explanations with comments

The documentation must be **exhaustive** - leave no stone unturned. If a component has a useEffect with complex dependencies, explain each dependency and why it's there. If there's a state machine with multiple phases, diagram it. If there's gesture handling with thresholds, document every threshold value and its reasoning.
</requirements>

<implementation>
Read each component file thoroughly. For complex components like VoyoPortraitPlayer (which has extensive features), break documentation into clear sections:

- Overview section at the top
- Props/Interface definitions
- State & Refs section
- Custom Hooks section (if any)
- Core Functions section (group related functions)
- Animation Variants section
- Layout Structure (ASCII diagram if helpful)
- Event Handlers section
- Performance Optimizations section
- Mobile Considerations section

For line-by-line explanations of complex logic:
```typescript
// EXAMPLE FORMAT:
// Line 45-60: Gesture detection state machine
const handleDrag = (info: PanInfo) => {
  // Line 47: Calculate relative position in viewport
  const relativeY = info.point.y / window.innerHeight;

  // Line 49-52: Determine zone based on vertical position
  // Top third = queue zone, bottom two-thirds = discovery zone
  if (relativeY < 0.33) {
    setActiveZone('queue');
  } else {
    setActiveZone('discovery');
  }
};
```

Why this matters: Developers need to understand not just WHAT the code does, but WHY each decision was made, especially for complex UI interactions.
</implementation>

<output>
Create a single comprehensive documentation file:

`/home/dash/voyo-music/.docs/components/VOYO-MODE-COMPONENTS.md`

Structure the file as:
1. **Overview** (VOYO Mode concept, architecture)
2. **Component Documentation** (one section per component, ordered logically)
3. **Shared Patterns** (common patterns used across VOYO components)
4. **Performance Notes** (VOYO-specific optimizations)
5. **Mobile Considerations** (touch gestures, orientation handling)

Use markdown formatting:
- `###` for component names
- `####` for subsections (Props, State, Functions, etc.)
- Code blocks for TypeScript interfaces and code examples
- Tables for props when appropriate
- Bullet lists for features/notes
- **Bold** for important concepts
- `inline code` for variable/function names
</output>

<verification>
Before declaring complete, verify:

1. ✅ All 8 components are documented
2. ✅ Every component has all required sections (Purpose, Props, State, Functions, etc.)
3. ✅ Complex logic has line-by-line explanations
4. ✅ Animation variants are documented with their parameters
5. ✅ Gesture handlers explain threshold values and detection logic
6. ✅ No TypeScript interfaces are missing documentation
7. ✅ File structure is clear and navigable
8. ✅ Code examples are accurate and match the actual source
</verification>

<success_criteria>
- Documentation file is comprehensive (expect 800+ lines for exhaustive coverage)
- Every prop, state variable, and function is documented
- Complex logic sections have explanatory comments/narratives
- Animation sequences are clear and detailed
- Developers can understand the code without reading the source files
- Technical accuracy is 100% (matches actual implementation)
</success_criteria>
