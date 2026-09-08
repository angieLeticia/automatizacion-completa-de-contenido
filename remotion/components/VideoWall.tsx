import { AbsoluteFill, OffthreadVideo } from "remotion";

type Props = {
  files: string[];
};

// A "surveillance wall" of simultaneous vertical clips filling a 16:9 frame
// edge to edge. Each column is close to the clips' native 9:16 ratio, so
// there's no single heavily-cropped clip and no blurred pillarbox — the
// whole frame reads as footage instead of one video floating in a box.
export const VideoWall: React.FC<Props> = ({ files }) => {
  return (
    <AbsoluteFill style={{ flexDirection: "row" }}>
      {files.map((file, i) => (
        <div
          key={file + i}
          style={{
            flex: 1,
            position: "relative",
            overflow: "hidden",
            borderLeft: i > 0 ? "1px solid rgba(0,0,0,0.7)" : undefined,
          }}
        >
          <OffthreadVideo src={file} volume={0} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
        </div>
      ))}
    </AbsoluteFill>
  );
};
