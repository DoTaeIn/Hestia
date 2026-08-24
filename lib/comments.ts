export type PageComment = {
  id: string;
  author: string;
  at: string;
  text: string;
  deletedBy?: string;
  deletedAt?: string;
};

export type CommentThread = {
  id: string;
  quote: string;
  anchorFrom: number;
  anchorTo: number;
  comments: PageComment[];
};
