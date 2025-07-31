import { createServerSupabase } from "../lib/supabase";
import { Pinecone } from "@pinecone-database/pinecone";

// Initialize Pinecone
const pinecone = new Pinecone({
  apiKey: process.env.PINECONE_API_KEY!,
});

const INDEX_NAME = process.env.PINECONE_INDEX_NAME || "dremma";

interface ChildResult {
  success: boolean;
  error?: string;
  status?: number;
  child?: any;
}

interface DeleteResult {
  success: boolean;
  error?: string;
  status?: number;
}

export async function getChildren(familyId: string) {
  try {
    const supabase = createServerSupabase();

    // Fetch children with session count using a subquery
    const { data: children, error } = await supabase
      .from("children")
      .select(
        `
        *,
        sessions_count:therapy_sessions(count)
      `
      )
      .eq("family_id", familyId)
      .eq("is_active", true)
      .order("created_at", { ascending: true });

    if (error) {
      console.error("Error fetching children:", error);
      throw new Error("Failed to fetch children");
    }

    // Transform the data to include the session count as a simple number
    const childrenWithSessionCount = (children || []).map((child) => ({
      ...child,
      sessions_count: child.sessions_count?.[0]?.count || 0,
    }));

    return childrenWithSessionCount;
  } catch (error) {
    console.error("Error getting children:", error);
    throw error;
  }
}

export async function getChild(childId: string, familyId: string) {
  try {
    const supabase = createServerSupabase();

    const { data: child, error } = await supabase
      .from("children")
      .select(
        `
        *,
        sessions_count:therapy_sessions(count)
      `
      )
      .eq("id", childId)
      .eq("family_id", familyId)
      .eq("is_active", true)
      .single();

    if (error || !child) {
      return null;
    }

    // Fetch knowledge base documents from Pinecone
    let knowledgeBaseDocuments: any[] = [];
    try {
      console.log(`Fetching knowledge base documents for child: ${childId}`);
      const index = pinecone.index(INDEX_NAME);

      // Use listPaginated for metadata-only queries (more efficient)
      const listResponse = await index.listPaginated({
        prefix: `kb-${childId}-`,
        limit: 100,
      });

      console.log(
        `Pinecone list response:`,
        JSON.stringify(listResponse, null, 2)
      );

      // If we have IDs, fetch the metadata for each
      if (listResponse.vectors && listResponse.vectors.length > 0) {
        const fetchResponse = await index.fetch(
          listResponse.vectors.map((v) => v.id!)
        );
        console.log(
          `Found ${Object.keys(fetchResponse.records || {}).length} documents`
        );

        knowledgeBaseDocuments = Object.values(fetchResponse.records || {})
          .filter(
            (record) =>
              record.metadata?.type === "knowledge_base_document" &&
              record.metadata?.child_id === childId
          )
          .map((record) => ({
            id: record.id,
            filename: record.metadata?.filename,
            file_type: record.metadata?.file_type,
            file_size: record.metadata?.file_size,
            uploaded_at: record.metadata?.uploaded_at,
            content_preview: record.metadata?.content_preview,
          }));
      }
    } catch (pineconeError) {
      console.error(
        "Error fetching knowledge base documents from Pinecone:",
        pineconeError
      );
      // Don't fail the entire request if Pinecone is down
      knowledgeBaseDocuments = [];
    }

    const childWithData = {
      ...child,
      sessions_count: child.sessions_count?.[0]?.count || 0,
      knowledge_base_documents: knowledgeBaseDocuments,
    };

    return childWithData;
  } catch (error) {
    console.error("Error getting child:", error);
    throw error;
  }
}

export async function createChild(
  familyId: string,
  childData: any
): Promise<ChildResult> {
  try {
    const supabase = createServerSupabase();

    const { data, error } = await supabase
      .from("children")
      .insert({
        family_id: familyId,
        name: childData.name,
        age: childData.age,
        gender: childData.gender,
        background: childData.background,
        current_concerns: childData.currentConcerns,
        triggers: childData.triggers,
        coping_strategies: childData.copingStrategies,
        previous_therapy: childData.previousTherapy,
        school_info: childData.schoolInfo,
        family_dynamics: childData.familyDynamics,
        social_situation: childData.socialSituation,
        interests: childData.interests,
        reason_for_adding: childData.reasonForAdding,
        parent_goals: childData.parentGoals,
        emergency_contacts: childData.emergencyContacts,
        is_active: true,
        profile_completed: true,
      })
      .select()
      .single();

    if (error) {
      console.error("Error creating child:", error);
      return { success: false, error: "Failed to create child" };
    }

    return { success: true, child: data };
  } catch (error) {
    console.error("Error creating child:", error);
    return { success: false, error: "Internal server error" };
  }
}

export async function updateChild(
  childId: string,
  familyId: string,
  childData: any
): Promise<ChildResult> {
  try {
    const supabase = createServerSupabase();

    const { data, error } = await supabase
      .from("children")
      .update({
        name: childData.name,
        age: childData.age,
        gender: childData.gender,
        background: childData.background,
        current_concerns: childData.currentConcerns,
        triggers: childData.triggers,
        coping_strategies: childData.copingStrategies,
        previous_therapy: childData.previousTherapy,
        school_info: childData.schoolInfo,
        family_dynamics: childData.familyDynamics,
        social_situation: childData.socialSituation,
        interests: childData.interests,
        reason_for_adding: childData.reasonForAdding,
        parent_goals: childData.parentGoals,
        emergency_contacts: childData.emergencyContacts,
        profile_completed: true,
      })
      .eq("id", childId)
      .eq("family_id", familyId)
      .select()
      .single();

    if (error) {
      console.error("Error updating child:", error);
      return { success: false, error: "Failed to update child" };
    }

    if (!data) {
      return { success: false, error: "Child not found", status: 404 };
    }

    return { success: true, child: data };
  } catch (error) {
    console.error("Error updating child:", error);
    return { success: false, error: "Internal server error" };
  }
}

export async function deleteChild(
  childId: string,
  familyId: string
): Promise<DeleteResult> {
  try {
    const supabase = createServerSupabase();

    // First, verify the child belongs to this family
    const { data: child, error: childError } = await supabase
      .from("children")
      .select("id, name")
      .eq("id", childId)
      .eq("family_id", familyId)
      .eq("is_active", true)
      .single();

    if (childError || !child) {
      return { success: false, error: "Child not found", status: 404 };
    }

    // Soft delete - set is_active to false
    const { error: deleteError } = await supabase
      .from("children")
      .update({ is_active: false })
      .eq("id", childId)
      .eq("family_id", familyId);

    if (deleteError) {
      console.error("Error deleting child:", deleteError);
      return { success: false, error: "Failed to delete child" };
    }

    // TODO: Delete associated knowledge base documents from Pinecone
    // This would be implemented when we migrate the knowledge base functionality

    console.log(`Successfully deleted child: ${child.name} (${childId})`);
    return { success: true };
  } catch (error) {
    console.error("Error in child deletion process:", error);
    return { success: false, error: "Internal server error" };
  }
}
