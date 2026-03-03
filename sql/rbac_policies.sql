-- DSLAW Portal RBAC Policies

-- 1. Enable RLS on all tables
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE account_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE activities ENABLE ROW LEVEL SECURITY;
ALTER TABLE matters ENABLE ROW LEVEL SECURITY;
ALTER TABLE rates ENABLE ROW LEVEL SECURITY;
ALTER TABLE matter_rate_overrides ENABLE ROW LEVEL SECURITY;

-- 2. Helper functions to avoid infinite recursion when checking roles
CREATE OR REPLACE FUNCTION get_my_role()
RETURNS text AS $$
  SELECT role FROM profiles WHERE id = auth.uid() LIMIT 1;
$$ LANGUAGE sql SECURITY DEFINER STABLE;

CREATE OR REPLACE FUNCTION is_admin()
RETURNS boolean AS $$
  SELECT get_my_role() IN ('super_admin', 'admin');
$$ LANGUAGE sql SECURITY DEFINER STABLE;

CREATE OR REPLACE FUNCTION is_accountant()
RETURNS boolean AS $$
  SELECT get_my_role() = 'accountant';
$$ LANGUAGE sql SECURITY DEFINER STABLE;

CREATE OR REPLACE FUNCTION check_account_access(acc_id uuid)
RETURNS boolean AS $$
  SELECT EXISTS (
    SELECT 1 FROM account_members
    WHERE account_id = acc_id AND user_id = auth.uid()
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- 3. Profiles Policies
-- Admins can read/write all PROFILES. Others can only read ALL profiles (needed for dropdowns) but only update their own.
DROP POLICY IF EXISTS "Profiles are viewable by everyone" ON profiles;
CREATE POLICY "Profiles are viewable by everyone" ON profiles FOR SELECT USING (true);

DROP POLICY IF EXISTS "Users can update own profile" ON profiles;
CREATE POLICY "Users can update own profile" ON profiles FOR UPDATE USING (auth.uid() = id);

DROP POLICY IF EXISTS "Admins can insert/update all profiles" ON profiles;
CREATE POLICY "Admins can insert/update all profiles" ON profiles FOR ALL USING (is_admin());

-- 4. Accounts Policies
-- Admins and accountants can view all accounts. Lawyers and staff_encoders view only assigned.
DROP POLICY IF EXISTS "Accounts viewable by role and assignment" ON accounts;
CREATE POLICY "Accounts viewable by role and assignment" ON accounts FOR SELECT USING (
  is_admin() OR is_accountant() OR check_account_access(id)
);

DROP POLICY IF EXISTS "Admins can insert/update accounts" ON accounts;
CREATE POLICY "Admins can insert/update accounts" ON accounts FOR ALL USING (is_admin());

-- 5. Account Members Policies
DROP POLICY IF EXISTS "Account members viewable by role" ON account_members;
CREATE POLICY "Account members viewable by role" ON account_members FOR SELECT USING (
  is_admin() OR is_accountant() OR check_account_access(account_id)
);

DROP POLICY IF EXISTS "Admins can manage account members" ON account_members;
CREATE POLICY "Admins can manage account members" ON account_members FOR ALL USING (is_admin());

-- 6. Activities Policies
-- Admins and Accountants can view all activities.
-- Lawyers/Staff view activities for their accounts, but ONLY their own submissions.
DROP POLICY IF EXISTS "Activities viewable by role" ON activities;
CREATE POLICY "Activities viewable by role" ON activities FOR SELECT USING (
  is_admin() OR is_accountant() OR 
  (check_account_access(account_id) AND created_by = auth.uid()) OR
  (check_account_access(account_id) AND performed_by = auth.uid())
);

-- Inserts: authenticatd users can insert if they have account access (or are admin)
DROP POLICY IF EXISTS "Users can insert activities" ON activities;
CREATE POLICY "Users can insert activities" ON activities FOR INSERT WITH CHECK (
  is_admin() OR check_account_access(account_id)
);

-- Updates: staff_encoder locked if NOT draft. Admins can update anything.
DROP POLICY IF EXISTS "Users can update activities" ON activities;
CREATE POLICY "Users can update activities" ON activities FOR UPDATE USING (
  is_admin() OR 
  (
    created_by = auth.uid() AND 
    (status = 'draft' OR get_my_role() != 'staff_encoder')
  )
);

-- Deletes: only drafts can be deleted by creator, admins can delete anything.
DROP POLICY IF EXISTS "Users can delete activities" ON activities;
CREATE POLICY "Users can delete activities" ON activities FOR DELETE USING (
  is_admin() OR (created_by = auth.uid() AND status = 'draft')
);

-- 7. Matters Policies
-- Matches account visibility
DROP POLICY IF EXISTS "Matters viewable by role" ON matters;
CREATE POLICY "Matters viewable by role" ON matters FOR SELECT USING (
  is_admin() OR is_accountant() OR check_account_access(account_id)
);

DROP POLICY IF EXISTS "Admins can manage matters" ON matters;
CREATE POLICY "Admins can manage matters" ON matters FOR ALL USING (is_admin());

-- 8. Rates Policies
-- Everyone can read rates. Only admins manage.
DROP POLICY IF EXISTS "Rates viewable by everyone" ON rates;
CREATE POLICY "Rates viewable by everyone" ON rates FOR SELECT USING (true);

DROP POLICY IF EXISTS "Admins can manage rates" ON rates;
CREATE POLICY "Admins can manage rates" ON rates FOR ALL USING (is_admin());
