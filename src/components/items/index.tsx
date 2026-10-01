import type { CardProps } from '../CanvasContext';
import { BoardCard, ColumnCard } from './Containers';
import { LinkCard } from './LinkCard';
import { TodoCard } from './ListCards';
import { TableCard } from './TableCard';
import { AudioCard, FileCard, ImageCard, VideoCard } from './MediaCards';
import { HeadingCard, NoteCard } from './TextCards';

export function ItemBody(props: CardProps) {
  switch (props.item.type) {
    case 'note': return <NoteCard {...props} />;
    case 'heading': return <HeadingCard {...props} />;
    case 'todo': return <TodoCard {...props} />;
    case 'table': return <TableCard {...props} />;
    case 'link': return <LinkCard {...props} />;
    case 'image': return <ImageCard {...props} />;
    case 'video': return <VideoCard {...props} />;
    case 'audio': return <AudioCard {...props} />;
    case 'file': return <FileCard {...props} />;
    case 'board': return <BoardCard {...props} />;
    case 'column': return <ColumnCard {...props} />;
    default: return <div className="note">Unsupported card</div>;
  }
}
