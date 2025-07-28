import { Pinecone } from '@pinecone-database/pinecone';
import OpenAI from 'openai';
import { createServerSupabase } from '../lib/supabase.js';

// Initialize Pinecone
const pinecone = new Pinecone({
  apiKey: process.env.PINECONE_API_KEY!
});

// Initialize OpenAI
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!
});

const INDEX_NAME = process.env.PINECONE_INDEX_NAME || 'dremma';

interface UploadResult {
  success: boolean;
  error?: string;
  status?: number;
  details?: string;
  receivedFiles?: any[];
  message?: string;
  documents?: any[];
}

interface FileResult {
  success: boolean;
  error?: string;
  status?: number;
  document?: any;
  message?: string;
}

interface KnowledgeBaseDocument {
  id: string;
  child_id: string;
  filename: string;
  content: string;
  file_type: string;
  file_size: number;
  uploaded_at: string;
  metadata: {
    topics?: string[];
    summary?: string;
    therapeutic_relevance?: string;
  };
}

export async function uploadFiles(childId: string, files: Express.Multer.File[], familyId: string): Promise<UploadResult> {
  try {
    console.log(`Upload request received for child: ${childId}`);
    console.log(`Number of files received: ${files.length}`);
    
    files.forEach((file, index) => {
      console.log(`File ${index + 1}: ${file.originalname}, type: ${file.mimetype}, size: ${file.size}`);
    });

    const index = pinecone.index(INDEX_NAME);
    const uploadedDocuments: KnowledgeBaseDocument[] = [];

    for (const file of files) {
      try {
        console.log(`Processing file: ${file.originalname}, type: ${file.mimetype}, size: ${file.size}`);
        
        // Validate file type
        const allowedTypes = ['text/plain'];
        if (!allowedTypes.includes(file.mimetype)) {
          console.warn(`Skipping file ${file.originalname}: Unsupported file type ${file.mimetype}`);
          continue;
        }

        // Validate file size (10MB limit)
        const maxSize = 10 * 1024 * 1024;
        if (file.size > maxSize) {
          console.warn(`Skipping file ${file.originalname}: File too large (${file.size} bytes)`);
          continue;
        }

        // Read file content
        let content = '';
        if (file.mimetype === 'text/plain') {
          content = file.buffer.toString('utf-8');
        } else {
          console.warn(`Skipping file ${file.originalname}: Non-text file processing not implemented yet`);
          continue;
        }

        if (!content.trim()) {
          console.warn(`Skipping file ${file.originalname}: Empty content`);
          continue;
        }

        // Generate document ID
        const documentId = `kb-${childId}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

        // Create embedding for the document content
        const embedding = await createEmbedding(content);

        // Store in Pinecone
        const vectorData = {
          id: documentId,
          values: embedding,
          metadata: {
            type: 'knowledge_base_document',
            child_id: childId,
            filename: file.originalname,
            file_type: file.mimetype,
            file_size: file.size,
            uploaded_at: new Date().toISOString(),
            content_preview: content.substring(0, 500)
          }
        };

        console.log(`Storing document in Pinecone:`, JSON.stringify(vectorData.metadata, null, 2));
        await index.upsert([vectorData]);

        // Create document record
        const document: KnowledgeBaseDocument = {
          id: documentId,
          child_id: childId,
          filename: file.originalname,
          content: content,
          file_type: file.mimetype,
          file_size: file.size,
          uploaded_at: new Date().toISOString(),
          metadata: {
            topics: [],
            summary: 'Document uploaded for therapeutic reference',
            therapeutic_relevance: 'General therapeutic document'
          }
        };

        uploadedDocuments.push(document);
        console.log(`✅ Successfully uploaded: ${file.originalname}`);

      } catch (error) {
        console.error(`Error processing file ${file.originalname}:`, error);
      }
    }

    if (uploadedDocuments.length === 0) {
      return {
        success: false,
        error: 'No valid files were uploaded',
        status: 400,
        details: 'Please ensure you are uploading .txt files only.',
        receivedFiles: files.map(f => ({ name: f.originalname, type: f.mimetype, size: f.size }))
      };
    }

    return {
      success: true,
      message: `Successfully uploaded ${uploadedDocuments.length} document(s)`,
      documents: uploadedDocuments.map(doc => ({
        id: doc.id,
        filename: doc.filename,
        file_type: doc.file_type,
        file_size: doc.file_size,
        uploaded_at: doc.uploaded_at,
        metadata: doc.metadata
      }))
    };

  } catch (error) {
    console.error('Error in knowledge base upload:', error);
    return {
      success: false,
      error: 'Internal server error',
      status: 500
    };
  }
}

export async function getUploadStatus(fileId: string): Promise<FileResult> {
  try {
    const index = pinecone.index(INDEX_NAME);
    
    const results = await index.query({
      id: fileId,
      topK: 1,
      includeMetadata: true
    });

    if (!results.matches || results.matches.length === 0) {
      return {
        success: false,
        error: 'Document not found',
        status: 404
      };
    }

    const document = results.matches[0];
    
    return {
      success: true,
      document: {
        id: document.id,
        filename: document.metadata?.filename,
        file_type: document.metadata?.file_type,
        file_size: document.metadata?.file_size,
        uploaded_at: document.metadata?.uploaded_at,
        content_preview: document.metadata?.content_preview
      }
    };

  } catch (error) {
    console.error('Error getting upload status:', error);
    return {
      success: false,
      error: 'Internal server error',
      status: 500
    };
  }
}

export async function updateUploadedFile(fileId: string, updateData: any, familyId: string): Promise<FileResult> {
  try {
    return {
      success: false,
      error: 'File updates not yet implemented',
      status: 501
    };
  } catch (error) {
    console.error('Error updating uploaded file:', error);
    return {
      success: false,
      error: 'Internal server error',
      status: 500
    };
  }
}

export async function deleteUploadedFile(fileId: string, childId: string, familyId: string): Promise<FileResult> {
  try {
    console.log(`Delete request for file: ${fileId}, child: ${childId}`);

    const index = pinecone.index(INDEX_NAME);
    await index.deleteOne(fileId);
    
    console.log(`✅ Successfully deleted: ${fileId}`);

    return {
      success: true,
      message: `Successfully deleted knowledge base document: ${fileId}`
    };

  } catch (error) {
    console.error('Error deleting document:', error);
    return {
      success: false,
      error: 'Internal server error',
      status: 500
    };
  }
}

async function createEmbedding(text: string): Promise<number[]> {
  try {
    const response = await openai.embeddings.create({
      model: 'text-embedding-3-large',
      input: text.substring(0, 8000),
      dimensions: 2048
    });

    return response.data[0].embedding;
  } catch (error) {
    console.error('Error creating embedding:', error);
    throw new Error('Failed to create embedding');
  }
} 